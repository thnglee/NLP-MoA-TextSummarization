
"""
Đánh giá 3 mô hình tóm tắt tiếng Việt từ các file TXT có cấu trúc:

INDEX:
<index>
GUID:
<guid>
TITLE:
<title>
VĂN BẢN GỐC:
<source>
TÓM TẮT THAM CHIẾU:
<reference>
TÓM TẮT DO MODEL SINH:
<prediction>
THỜI GIAN TÓM TẮT:
<seconds> giây

4 nhóm metric chính:
1) Lexical overlap: ROUGE-1 F1, ROUGE-2 F1, ROUGE-L F1
2) Semantic quality: BERTScore Precision, Recall, F1
3) Factual consistency: Entity precision, Number consistency, Contradiction rate
4) Performance: Inference time trung bình (giây / mẫu)

Metric bổ sung được tính nếu chạy NLI:
- Hallucination rate (claim không được nguồn entail)
- Mean entailment probability

Mặc định script tự nhận đúng cấu trúc dữ liệu đã cung cấp:
results/
  nishikyen/*.txt
  sft_model/*.txt
  vit5-base-HLK-0001/test_predictions_txt/*.txt

Ví dụ:
    python evaluate_summarization_models.py --results-dir results --output-dir evaluation

Nếu chỉ muốn test parser/ROUGE/thời gian thật nhanh:
    python evaluate_summarization_models.py --results-dir results --skip-bertscore --skip-nli

Gợi ý GPU 12-16 GB:
    python evaluate_summarization_models.py --results-dir results \
        --bert-batch-size 8 --nli-batch-size 8
"""

from __future__ import annotations

import argparse
import csv
import gc
import json
import math
import re
import statistics
import sys
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import os

os.environ["HF_HOME"] = r"D:\huggingface_cache"
os.environ["HF_HUB_CACHE"] = r"D:\huggingface_cache\hub"


# -----------------------------------------------------------------------------
# CẤU HÌNH 3 MODEL THEO ĐÚNG CẤU TRÚC ZIP ĐÃ CUNG CẤP
# -----------------------------------------------------------------------------
MODEL_DIRS = {
    "HKL-ViT5": Path("vit5-base-HLK-0001") / "test_predictions_txt",
    "Nishikyen/vit5-vietnamese-news": Path("nishikyen"),
    "thnhan/sft_model": Path("sft_model"),
}

FIELD_NAMES = [
    "INDEX",
    "GUID",
    "TITLE",
    "VĂN BẢN GỐC",
    "TÓM TẮT THAM CHIẾU",
    "TÓM TẮT DO MODEL SINH",
    "THỜI GIAN TÓM TẮT",
]
FIELD_PATTERN = re.compile(
    r"(?m)^(INDEX|GUID|TITLE|VĂN BẢN GỐC|TÓM TẮT THAM CHIẾU|"
    r"TÓM TẮT DO MODEL SINH|THỜI GIAN TÓM TẮT):\s*$"
)


@dataclass
class Sample:
    model: str
    index: str
    guid: str
    title: str
    source: str
    reference: str
    prediction: str
    inference_time: float
    path: str


# -----------------------------------------------------------------------------
# ĐỌC / PARSE FILE TXT
# -----------------------------------------------------------------------------
def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    text = text.replace("\ufeff", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return text.strip()


def parse_sections(text: str) -> Dict[str, str]:
    """Tách các section dựa trên marker đứng riêng một dòng."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    matches = list(FIELD_PATTERN.finditer(text))
    fields: Dict[str, str] = {}

    for i, match in enumerate(matches):
        name = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        fields[name] = text[start:end].strip()

    missing = [name for name in FIELD_NAMES if name not in fields]
    if missing:
        raise ValueError(f"Thiếu section: {missing}")
    return fields


def parse_time_seconds(raw: str) -> float:
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", raw)
    if not m:
        raise ValueError(f"Không đọc được thời gian từ: {raw!r}")
    return float(m.group(0).replace(",", "."))


def parse_txt_file(path: Path, model_name: str) -> Sample:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    f = parse_sections(text)
    return Sample(
        model=model_name,
        index=normalize_text(f["INDEX"]),
        guid=normalize_text(f["GUID"]),
        title=normalize_text(f["TITLE"]),
        source=normalize_text(f["VĂN BẢN GỐC"]),
        reference=normalize_text(f["TÓM TẮT THAM CHIẾU"]),
        prediction=normalize_text(f["TÓM TẮT DO MODEL SINH"]),
        inference_time=parse_time_seconds(f["THỜI GIAN TÓM TẮT"]),
        path=str(path),
    )


def load_models(results_dir: Path) -> Dict[str, List[Sample]]:
    all_models: Dict[str, List[Sample]] = {}
    for model_name, relative_dir in MODEL_DIRS.items():
        model_dir = results_dir / relative_dir
        if not model_dir.exists():
            raise FileNotFoundError(
                f"Không tìm thấy thư mục cho {model_name}: {model_dir}\n"
                f"Hãy trỏ --results-dir tới thư mục results/ đã giải nén."
            )
        files = sorted(model_dir.glob("*.txt"))
        if not files:
            raise FileNotFoundError(f"Không có file .txt trong {model_dir}")

        samples: List[Sample] = []
        errors = []
        for p in files:
            try:
                samples.append(parse_txt_file(p, model_name))
            except Exception as exc:
                errors.append((str(p), str(exc)))

        if errors:
            preview = "\n".join(f"- {p}: {e}" for p, e in errors[:10])
            raise RuntimeError(
                f"Có {len(errors)} file parse lỗi trong {model_name}.\n{preview}"
            )

        all_models[model_name] = samples
        print(f"[OK] {model_name}: {len(samples)} file")
    return all_models


def key_of(sample: Sample) -> str:
    return sample.guid if sample.guid else sample.index


def align_common_samples(
    models: Dict[str, List[Sample]],
) -> Tuple[Dict[str, List[Sample]], List[str]]:
    """Chỉ giữ các GUID xuất hiện ở cả 3 model để so sánh công bằng."""
    keyed = {
        model: {key_of(s): s for s in samples}
        for model, samples in models.items()
    }
    common = set.intersection(*(set(d.keys()) for d in keyed.values()))
    if not common:
        raise RuntimeError("Không tìm thấy GUID/INDEX chung giữa các model.")

    def sort_key(k: str):
        try:
            return (0, int(k))
        except ValueError:
            return (1, k)

    ordered_keys = sorted(common, key=sort_key)
    aligned = {
        model: [keyed[model][k] for k in ordered_keys]
        for model in MODEL_DIRS
    }

    # Kiểm tra source/reference giữa các model có cùng nhau hay không.
    model_names = list(MODEL_DIRS.keys())
    base = keyed[model_names[0]]
    mismatch_source = 0
    mismatch_ref = 0
    for k in ordered_keys:
        b = base[k]
        for name in model_names[1:]:
            s = keyed[name][k]
            mismatch_source += int(s.source != b.source)
            mismatch_ref += int(s.reference != b.reference)

    if mismatch_source or mismatch_ref:
        print(
            f"[WARN] Có khác biệt nội dung cùng GUID: "
            f"source={mismatch_source}, reference={mismatch_ref}",
            file=sys.stderr,
        )
    print(f"[OK] Số mẫu chung dùng để so sánh: {len(ordered_keys)}")
    return aligned, ordered_keys


# -----------------------------------------------------------------------------
# NHÓM 1 - ROUGE (tokenizer Unicode phù hợp tiếng Việt)
# -----------------------------------------------------------------------------
def word_tokens(text: str) -> List[str]:
    text = unicodedata.normalize("NFC", text.lower()).replace("_", " ")
    # \w trong Python Unicode giữ được ký tự tiếng Việt.
    return re.findall(r"\w+", text, flags=re.UNICODE)


def prf(overlap: int, pred_n: int, ref_n: int) -> Tuple[float, float, float]:
    p = overlap / pred_n if pred_n else 0.0
    r = overlap / ref_n if ref_n else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return p, r, f


def rouge_n(pred: str, ref: str, n: int) -> Tuple[float, float, float]:
    pt = word_tokens(pred)
    rt = word_tokens(ref)
    png = Counter(tuple(pt[i : i + n]) for i in range(max(0, len(pt) - n + 1)))
    rng = Counter(tuple(rt[i : i + n]) for i in range(max(0, len(rt) - n + 1)))
    overlap = sum((png & rng).values())
    return prf(overlap, sum(png.values()), sum(rng.values()))


def lcs_length(a: Sequence[str], b: Sequence[str]) -> int:
    # O(min(m,n)) memory.
    if len(a) < len(b):
        a, b = b, a
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, start=1):
            if x == y:
                cur.append(prev[j - 1] + 1)
            else:
                cur.append(max(cur[-1], prev[j]))
        prev = cur
    return prev[-1]


def rouge_l(pred: str, ref: str) -> Tuple[float, float, float]:
    pt = word_tokens(pred)
    rt = word_tokens(ref)
    lcs = lcs_length(pt, rt)
    return prf(lcs, len(pt), len(rt))


def compute_rouge_for_model(samples: Sequence[Sample]) -> Tuple[Dict[str, float], List[Dict]]:
    rows = []
    r1s, r2s, rls = [], [], []
    for s in samples:
        r1p, r1r, r1f = rouge_n(s.prediction, s.reference, 1)
        r2p, r2r, r2f = rouge_n(s.prediction, s.reference, 2)
        rlp, rlr, rlf = rouge_l(s.prediction, s.reference)
        rows.append(
            {
                "rouge1_precision": r1p,
                "rouge1_recall": r1r,
                "rouge1_f1": r1f,
                "rouge2_precision": r2p,
                "rouge2_recall": r2r,
                "rouge2_f1": r2f,
                "rougeL_precision": rlp,
                "rougeL_recall": rlr,
                "rougeL_f1": rlf,
            }
        )
        r1s.append(r1f)
        r2s.append(r2f)
        rls.append(rlf)

    return {
        "ROUGE-1": statistics.fmean(r1s),
        "ROUGE-2": statistics.fmean(r2s),
        "ROUGE-L": statistics.fmean(rls),
    }, rows


# -----------------------------------------------------------------------------
# NHÓM 2 - BERTScore
# -----------------------------------------------------------------------------
def resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def compute_bertscore_all_models(
    models: Dict[str, List[Sample]],
    model_type: str,
    batch_size: int,
    device: str,
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, List[Dict]]]:
    try:
        from bert_score import BERTScorer
    except ImportError as exc:
        raise RuntimeError(
            "Thiếu bert-score. Cài bằng: pip install bert-score"
        ) from exc

    print(f"[BERTScore] encoder={model_type}, device={device}, batch={batch_size}")
    scorer = BERTScorer(
        model_type=model_type,
        device=device,
        batch_size=batch_size,
        idf=False,
        rescale_with_baseline=False,
    )

    summary: Dict[str, Dict[str, float]] = {}
    details: Dict[str, List[Dict]] = {}
    for model_name, samples in models.items():
        cands = [s.prediction for s in samples]
        refs = [s.reference for s in samples]
        p, r, f1 = scorer.score(cands, refs, batch_size=batch_size)
        p_l = p.detach().cpu().tolist()
        r_l = r.detach().cpu().tolist()
        f_l = f1.detach().cpu().tolist()
        summary[model_name] = {
            "BERTScore Precision": statistics.fmean(p_l),
            "BERTScore Recall": statistics.fmean(r_l),
            "BERTScore F1": statistics.fmean(f_l),
        }
        details[model_name] = [
            {
                "bertscore_precision": pp,
                "bertscore_recall": rr,
                "bertscore_f1": ff,
            }
            for pp, rr, ff in zip(p_l, r_l, f_l)
        ]
        print(f"[OK] BERTScore: {model_name}")

    del scorer
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return summary, details


# -----------------------------------------------------------------------------
# NHÓM 3A - ENTITY PRECISION
# -----------------------------------------------------------------------------
ENTITY_FALLBACK_RE = re.compile(
    r"\b(?:[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢ"
    r"ÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][\wÀ-ỹ.-]*"
    r"(?:\s+[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢ"
    r"ÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][\wÀ-ỹ.-]*)+)\b"
)


def norm_match_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def extract_entities_regex(text: str) -> List[str]:
    return list(dict.fromkeys(m.group(0).strip() for m in ENTITY_FALLBACK_RE.finditer(text)))


def make_entity_extractor(backend: str):
    if backend == "regex":
        print("[Entity] backend=regex (fallback heuristic)")
        return extract_entities_regex

    try:
        from underthesea import ner
    except ImportError as exc:
        raise RuntimeError(
            "Thiếu underthesea. Cài bằng: pip install underthesea\n"
            "Hoặc chạy --entity-backend regex để dùng fallback nhẹ hơn."
        ) from exc

    def extract(text: str) -> List[str]:
        try:
            tagged = ner(text)
        except Exception:
            return extract_entities_regex(text)

        entities: List[str] = []
        current: List[str] = []

        def flush():
            nonlocal current
            if current:
                ent = " ".join(current).strip()
                if ent:
                    entities.append(ent)
                current = []

        for item in tagged:
            # underthesea thường trả tuple: (word, POS, chunk, NER)
            if not isinstance(item, (list, tuple)) or len(item) < 4:
                continue
            word = str(item[0])
            tag = str(item[-1])
            if tag.startswith("B-"):
                flush()
                current = [word]
            elif tag.startswith("I-"):
                if current:
                    current.append(word)
                else:
                    current = [word]
            else:
                flush()
        flush()
        # unique, giữ thứ tự
        return list(dict.fromkeys(entities))

    print("[Entity] backend=underthesea")
    return extract


def entity_precision_sample(source: str, prediction: str, extractor) -> Tuple[int, int, float]:
    entities = extractor(prediction)
    src_norm = f" {norm_match_text(source)} "
    supported = 0
    for ent in entities:
        e = norm_match_text(ent)
        if e and f" {e} " in src_norm:
            supported += 1
    total = len(entities)
    score = supported / total if total else float("nan")
    return supported, total, score


# -----------------------------------------------------------------------------
# NHÓM 3B - NUMBER CONSISTENCY
# -----------------------------------------------------------------------------
NUMBER_RE = re.compile(r"(?<!\w)\d+(?:[.,]\d+)?\s*%?(?!\w)", flags=re.UNICODE)


def normalize_number(x: str) -> str:
    x = x.strip().replace(" ", "").replace(",", ".")
    # 2.0 -> 2, nhưng vẫn giữ 2.5; giữ dấu %.
    pct = x.endswith("%")
    core = x[:-1] if pct else x
    try:
        n = float(core)
        core = str(int(n)) if n.is_integer() else str(n)
    except ValueError:
        pass
    return core + ("%" if pct else "")


def extract_numbers(text: str) -> List[str]:
    return [normalize_number(m.group(0)) for m in NUMBER_RE.finditer(text)]


def number_consistency_sample(source: str, prediction: str) -> Tuple[int, int, float]:
    source_nums = set(extract_numbers(source))
    pred_nums = extract_numbers(prediction)
    supported = sum(1 for n in pred_nums if n in source_nums)
    total = len(pred_nums)
    score = supported / total if total else float("nan")
    return supported, total, score


# -----------------------------------------------------------------------------
# NHÓM 3C - CONTRADICTION / HALLUCINATION BẰNG NLI
# -----------------------------------------------------------------------------
def split_sentences(text: str) -> List[str]:
    text = normalize_text(text)
    if not text:
        return []
    parts = re.split(r"(?<=[.!?…])\s+|\s*[;]\s+", text)
    return [p.strip() for p in parts if len(p.strip()) >= 3]


def lexical_overlap_score(a_tokens: set, b_tokens: set) -> float:
    if not a_tokens or not b_tokens:
        return 0.0
    overlap = len(a_tokens & b_tokens)
    return overlap / math.sqrt(len(a_tokens) * len(b_tokens))


class EvidenceRetriever:
    def __init__(self, samples: Sequence[Sample]):
        self.cache: Dict[str, List[Tuple[str, set]]] = {}
        for s in samples:
            k = key_of(s)
            sentences = split_sentences(s.source)
            if not sentences:
                sentences = [s.source]
            self.cache[k] = [(sent, set(word_tokens(sent))) for sent in sentences]

    def retrieve(self, sample: Sample, claim: str, top_k: int = 3) -> str:
        claim_tokens = set(word_tokens(claim))
        candidates = self.cache[key_of(sample)]
        ranked = sorted(
            candidates,
            key=lambda x: lexical_overlap_score(claim_tokens, x[1]),
            reverse=True,
        )
        selected = [sent for sent, _ in ranked[: max(1, top_k)]]
        return " ".join(selected)


def resolve_nli_label_indices(config, contradiction_override: Optional[int], entailment_override: Optional[int]):
    id2label = getattr(config, "id2label", {}) or {}
    normalized = {int(k): str(v).lower() for k, v in id2label.items()}

    contradiction = contradiction_override
    entailment = entailment_override

    if contradiction is None:
        for idx, label in normalized.items():
            if "contrad" in label:
                contradiction = idx
                break
    if entailment is None:
        for idx, label in normalized.items():
            if "entail" in label:
                entailment = idx
                break

    if contradiction is None or entailment is None:
        raise RuntimeError(
            "Không tự xác định được label entailment/contradiction từ config NLI.\n"
            f"id2label={id2label}\n"
            "Hãy truyền --nli-contradiction-label-id và --nli-entailment-label-id."
        )
    return int(contradiction), int(entailment)


def compute_nli_all_models(
    models: Dict[str, List[Sample]],
    nli_model: str,
    batch_size: int,
    device: str,
    evidence_top_k: int,
    contradiction_threshold: float,
    entailment_threshold: float,
    contradiction_label_id: Optional[int],
    entailment_label_id: Optional[int],
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, List[Dict]]]:
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "Thiếu torch/transformers. Cài bằng: pip install torch transformers sentencepiece"
        ) from exc

    print(f"[NLI] model={nli_model}, device={device}, batch={batch_size}")
    tokenizer = AutoTokenizer.from_pretrained(nli_model)
    model = AutoModelForSequenceClassification.from_pretrained(nli_model)
    model.eval()
    model.to(device)
    contradiction_idx, entailment_idx = resolve_nli_label_indices(
        model.config, contradiction_label_id, entailment_label_id
    )
    print(
        f"[NLI] contradiction_label_id={contradiction_idx}, "
        f"entailment_label_id={entailment_idx}"
    )

    # Source giống nhau giữa model => dùng model đầu tiên để tạo retriever cache.
    first_model = next(iter(models.values()))
    retriever = EvidenceRetriever(first_model)

    summaries: Dict[str, Dict[str, float]] = {}
    details: Dict[str, List[Dict]] = {}

    for model_name, samples in models.items():
        premises: List[str] = []
        hypotheses: List[str] = []
        owner: List[int] = []

        for i, sample in enumerate(samples):
            claims = split_sentences(sample.prediction)
            if not claims and sample.prediction:
                claims = [sample.prediction]
            for claim in claims:
                premises.append(retriever.retrieve(sample, claim, evidence_top_k))
                hypotheses.append(claim)
                owner.append(i)

        contradiction_probs = [0.0] * len(premises)
        entailment_probs = [0.0] * len(premises)

        for start in range(0, len(premises), batch_size):
            p_batch = premises[start : start + batch_size]
            h_batch = hypotheses[start : start + batch_size]
            encoded = tokenizer(
                p_batch,
                h_batch,
                padding=True,
                truncation="only_first",
                max_length=512,
                return_tensors="pt",
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}
            with torch.no_grad():
                logits = model(**encoded).logits
                probs = torch.softmax(logits, dim=-1).detach().cpu()
            for j in range(probs.shape[0]):
                contradiction_probs[start + j] = float(probs[j, contradiction_idx])
                entailment_probs[start + j] = float(probs[j, entailment_idx])

        per_sample = [
            {
                "nli_claim_count": 0,
                "nli_contradiction_count": 0,
                "nli_hallucination_count": 0,
                "nli_contradiction_prob_sum": 0.0,
                "nli_entailment_prob_sum": 0.0,
            }
            for _ in samples
        ]

        total_claims = len(owner)
        total_contradictions = 0
        total_hallucinations = 0
        sum_entailment = 0.0
        sum_contradiction = 0.0

        for i, cp, ep in zip(owner, contradiction_probs, entailment_probs):
            # Contradiction: xác suất đủ cao VÀ cao hơn entailment.
            contradicted = cp >= contradiction_threshold and cp > ep
            # Hallucination/unsupported: nguồn không entail claim đủ mạnh.
            hallucinated = ep < entailment_threshold

            d = per_sample[i]
            d["nli_claim_count"] += 1
            d["nli_contradiction_count"] += int(contradicted)
            d["nli_hallucination_count"] += int(hallucinated)
            d["nli_contradiction_prob_sum"] += cp
            d["nli_entailment_prob_sum"] += ep

            total_contradictions += int(contradicted)
            total_hallucinations += int(hallucinated)
            sum_entailment += ep
            sum_contradiction += cp

        for d in per_sample:
            n = d["nli_claim_count"]
            d["contradiction_rate"] = d["nli_contradiction_count"] / n if n else float("nan")
            d["hallucination_rate"] = d["nli_hallucination_count"] / n if n else float("nan")
            d["mean_contradiction_probability"] = d["nli_contradiction_prob_sum"] / n if n else float("nan")
            d["mean_entailment_probability"] = d["nli_entailment_prob_sum"] / n if n else float("nan")

        summaries[model_name] = {
            "Contradiction rate": total_contradictions / total_claims if total_claims else float("nan"),
            "Hallucination rate": total_hallucinations / total_claims if total_claims else float("nan"),
            "Mean entailment probability": sum_entailment / total_claims if total_claims else float("nan"),
            "Mean contradiction probability": sum_contradiction / total_claims if total_claims else float("nan"),
            "NLI claim count": total_claims,
        }
        details[model_name] = per_sample
        print(f"[OK] NLI: {model_name}, claims={total_claims}")

    del model, tokenizer
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return summaries, details


# -----------------------------------------------------------------------------
# AGGREGATE FACTUAL + PERFORMANCE
# -----------------------------------------------------------------------------
def compute_entity_number(
    samples: Sequence[Sample], extractor
) -> Tuple[Dict[str, float], List[Dict]]:
    entity_supported_total = 0
    entity_total = 0
    number_supported_total = 0
    number_total = 0
    rows = []

    for s in samples:
        es, et, ep = entity_precision_sample(s.source, s.prediction, extractor)
        ns, nt, nc = number_consistency_sample(s.source, s.prediction)
        entity_supported_total += es
        entity_total += et
        number_supported_total += ns
        number_total += nt
        rows.append(
            {
                "entity_supported": es,
                "entity_total": et,
                "entity_precision": ep,
                "number_supported": ns,
                "number_total": nt,
                "number_consistency": nc,
            }
        )

    return {
        "Entity precision": entity_supported_total / entity_total if entity_total else float("nan"),
        "Number consistency": number_supported_total / number_total if number_total else float("nan"),
        "Entity supported": entity_supported_total,
        "Entity generated": entity_total,
        "Number supported": number_supported_total,
        "Number generated": number_total,
    }, rows


def percentile(values: Sequence[float], q: float) -> float:
    if not values:
        return float("nan")
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = (len(xs) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return xs[lo]
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def compute_performance(samples: Sequence[Sample]) -> Dict[str, float]:
    times = [s.inference_time for s in samples]
    mean_t = statistics.fmean(times)
    return {
        "Inference time": mean_t,
        "Inference time median": statistics.median(times),
        "Inference time P95": percentile(times, 0.95),
        "Inference time std": statistics.pstdev(times) if len(times) > 1 else 0.0,
        "Total inference time": sum(times),
        "Throughput samples/s": (1.0 / mean_t) if mean_t > 0 else float("inf"),
    }


# -----------------------------------------------------------------------------
# OUTPUT
# -----------------------------------------------------------------------------
def fmt(x, digits: int = 4) -> str:
    if x is None:
        return "N/A"
    if isinstance(x, str):
        return x
    try:
        if math.isnan(float(x)):
            return "N/A"
    except Exception:
        return str(x)
    return f"{float(x):.{digits}f}"


def markdown_table(metric_names: Sequence[str], values: Dict[str, Dict[str, float]], suffix: str = "") -> str:
    models = list(MODEL_DIRS.keys())
    header = "| Độ đo | " + " | ".join(models) + " |"
    sep = "|---|" + "---:|" * len(models)
    lines = [header, sep]
    for metric in metric_names:
        cells = []
        for model in models:
            val = values.get(model, {}).get(metric)
            text = fmt(val)
            if suffix and text != "N/A":
                text += suffix
            cells.append(text)
        lines.append("| " + metric + " | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def build_report(
    lexical: Dict[str, Dict[str, float]],
    semantic: Dict[str, Dict[str, float]],
    factual: Dict[str, Dict[str, float]],
    performance: Dict[str, Dict[str, float]],
    n_samples: int,
    bert_model: str,
    nli_model: str,
    skip_bertscore: bool,
    skip_nli: bool,
) -> str:
    out = []
    out.append("# BÁO CÁO ĐÁNH GIÁ 3 MÔ HÌNH TÓM TẮT TIẾNG VIỆT")
    out.append("")
    out.append(f"Số mẫu chung/model: **{n_samples}**")
    out.append("ROUGE và BERTScore: model summary ↔ tóm tắt tham chiếu.")
    out.append("Factual consistency: model summary ↔ văn bản gốc.")
    out.append("")

    out.append("## NHÓM 1 — Lexical overlap")
    out.append("")
    out.append(markdown_table(["ROUGE-1", "ROUGE-2", "ROUGE-L"], lexical))
    out.append("")
    out.append("Các giá trị ROUGE trong bảng là **F1 macro trung bình trên toàn bộ mẫu**; càng cao càng tốt.")
    out.append("")

    out.append("## NHÓM 2 — Semantic quality")
    out.append("")
    out.append(markdown_table(
        ["BERTScore Precision", "BERTScore Recall", "BERTScore F1"], semantic
    ))
    out.append("")
    if skip_bertscore:
        out.append("BERTScore bị bỏ qua (--skip-bertscore).")
    else:
        out.append(f"BERTScore encoder: `{bert_model}`. Càng cao càng tốt.")
    out.append("")

    out.append("## NHÓM 3 — Factual consistency")
    out.append("")
    out.append(markdown_table(
        ["Entity precision", "Number consistency", "Contradiction rate"], factual
    ))
    out.append("")
    out.append("Entity precision và Number consistency: càng cao càng tốt. Contradiction rate: càng thấp càng tốt.")
    if not skip_nli:
        out.append(f"NLI model: `{nli_model}`.")
        out.append("")
        out.append("### Metric bổ sung")
        out.append("")
        out.append(markdown_table(
            ["Hallucination rate", "Mean entailment probability"], factual
        ))
    else:
        out.append("Contradiction/Hallucination bị bỏ qua (--skip-nli).")
    out.append("")

    out.append("## NHÓM 4 — Performance")
    out.append("")
    out.append(markdown_table(["Inference time"], performance, suffix=" s"))
    out.append("")
    out.append("Inference time trong bảng = **thời gian trung bình / mẫu**, lấy trực tiếp từ `THỜI GIAN TÓM TẮT` trong file TXT; càng thấp càng tốt.")
    out.append("")
    out.append("### Thống kê thời gian bổ sung")
    out.append("")
    out.append(markdown_table(
        ["Inference time median", "Inference time P95", "Inference time std"],
        performance,
        suffix=" s",
    ))
    out.append("")
    return "\n".join(out)


def write_csv(path: Path, rows: List[Dict]):
    if not rows:
        return
    keys = []
    seen = set()
    for row in rows:
        for k in row.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def json_safe(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    return value


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Đánh giá 3 mô hình tóm tắt theo ROUGE, BERTScore, factual consistency và inference time."
    )
    parser.add_argument("--results-dir", type=Path, default=Path("results"))
    parser.add_argument("--output-dir", type=Path, default=Path("output/evaluation"))
    parser.add_argument("--device", default="auto", help="auto | cpu | cuda | cuda:0 ...")

    parser.add_argument("--bert-model", default="xlm-roberta-base")
    parser.add_argument("--bert-batch-size", type=int, default=16)
    parser.add_argument("--skip-bertscore", action="store_true")

    parser.add_argument(
        "--entity-backend",
        choices=["underthesea", "regex"],
        default="underthesea",
    )

    parser.add_argument(
        "--nli-model",
        default="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
    )
    parser.add_argument("--nli-batch-size", type=int, default=16)
    parser.add_argument("--evidence-top-k", type=int, default=3)
    parser.add_argument("--contradiction-threshold", type=float, default=0.50)
    parser.add_argument("--entailment-threshold", type=float, default=0.50)
    parser.add_argument("--nli-contradiction-label-id", type=int, default=None)
    parser.add_argument("--nli-entailment-label-id", type=int, default=None)
    parser.add_argument("--skip-nli", action="store_true")

    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    device = resolve_device(args.device)
    print(f"[INFO] Device: {device}")

    models = load_models(args.results_dir)
    models, common_keys = align_common_samples(models)

    # Dữ liệu chi tiết từng sample/model.
    per_sample: Dict[str, List[Dict]] = {}
    for model_name, samples in models.items():
        per_sample[model_name] = [
            {
                "model": model_name,
                "index": s.index,
                "guid": s.guid,
                "title": s.title,
                "inference_time_seconds": s.inference_time,
                "file": s.path,
            }
            for s in samples
        ]

    # ---- Group 1: ROUGE ----
    lexical: Dict[str, Dict[str, float]] = {}
    for model_name, samples in models.items():
        summary, detail = compute_rouge_for_model(samples)
        lexical[model_name] = summary
        for row, extra in zip(per_sample[model_name], detail):
            row.update(extra)
        print(f"[OK] ROUGE: {model_name}")

    # ---- Group 2: BERTScore ----
    semantic: Dict[str, Dict[str, float]] = {
        name: {
            "BERTScore Precision": None,
            "BERTScore Recall": None,
            "BERTScore F1": None,
        }
        for name in MODEL_DIRS
    }
    if not args.skip_bertscore:
        semantic, bert_detail = compute_bertscore_all_models(
            models=models,
            model_type=args.bert_model,
            batch_size=args.bert_batch_size,
            device=device,
        )
        for model_name in models:
            for row, extra in zip(per_sample[model_name], bert_detail[model_name]):
                row.update(extra)

    # ---- Group 3: Entity + Number ----
    extractor = make_entity_extractor(args.entity_backend)
    factual: Dict[str, Dict[str, float]] = {}
    for model_name, samples in models.items():
        summary, detail = compute_entity_number(samples, extractor)
        factual[model_name] = summary
        factual[model_name]["Contradiction rate"] = None
        factual[model_name]["Hallucination rate"] = None
        factual[model_name]["Mean entailment probability"] = None
        for row, extra in zip(per_sample[model_name], detail):
            row.update(extra)
        print(f"[OK] Entity/Number: {model_name}")

    if not args.skip_nli:
        nli_summary, nli_detail = compute_nli_all_models(
            models=models,
            nli_model=args.nli_model,
            batch_size=args.nli_batch_size,
            device=device,
            evidence_top_k=args.evidence_top_k,
            contradiction_threshold=args.contradiction_threshold,
            entailment_threshold=args.entailment_threshold,
            contradiction_label_id=args.nli_contradiction_label_id,
            entailment_label_id=args.nli_entailment_label_id,
        )
        for model_name in models:
            factual[model_name].update(nli_summary[model_name])
            for row, extra in zip(per_sample[model_name], nli_detail[model_name]):
                row.update(extra)

    # ---- Group 4: Performance ----
    performance = {
        model_name: compute_performance(samples)
        for model_name, samples in models.items()
    }

    # ---- Write outputs ----
    report = build_report(
        lexical=lexical,
        semantic=semantic,
        factual=factual,
        performance=performance,
        n_samples=len(common_keys),
        bert_model=args.bert_model,
        nli_model=args.nli_model,
        skip_bertscore=args.skip_bertscore,
        skip_nli=args.skip_nli,
    )
    (args.output_dir / "evaluation_report.txt").write_text(report, encoding="utf-8")
    (args.output_dir / "evaluation_report.md").write_text(report, encoding="utf-8")

    summary_json = {
        "n_common_samples": len(common_keys),
        "models": list(MODEL_DIRS.keys()),
        "group1_lexical_overlap": lexical,
        "group2_semantic_quality": semantic,
        "group3_factual_consistency": factual,
        "group4_performance": performance,
        "config": {
            "bert_model": args.bert_model,
            "nli_model": args.nli_model,
            "entity_backend": args.entity_backend,
            "device": device,
            "contradiction_threshold": args.contradiction_threshold,
            "entailment_threshold": args.entailment_threshold,
            "evidence_top_k": args.evidence_top_k,
        },
    }
    (args.output_dir / "metrics_summary.json").write_text(
        json.dumps(json_safe(summary_json), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    flat_rows = []
    for model_name in MODEL_DIRS:
        flat_rows.extend(per_sample[model_name])
    write_csv(args.output_dir / "per_sample_metrics.csv", flat_rows)

    print("\n" + report)
    print("\n[ĐÃ LƯU]")
    print(f"- {args.output_dir / 'evaluation_report.txt'}")
    print(f"- {args.output_dir / 'evaluation_report.md'}")
    print(f"- {args.output_dir / 'metrics_summary.json'}")
    print(f"- {args.output_dir / 'per_sample_metrics.csv'}")


if __name__ == "__main__":
    main()