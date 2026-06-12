import os
import logging
import contextlib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
logger = logging.getLogger("bert_service")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MODEL_NAME: str = os.environ.get("BERT_MODEL", "vinai/phobert-base")

# ---------------------------------------------------------------------------
# Global scorer — loaded once at startup
# ---------------------------------------------------------------------------
from bert_score import BERTScorer  # noqa: E402  (import after env vars are in scope)

bert_scorer: BERTScorer | None = None


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global bert_scorer
    logger.info(f"Loading BERTScorer with model='{MODEL_NAME}' on CPU …")
    try:
        bert_scorer = BERTScorer(
            model_type=MODEL_NAME,
            lang="vi",
            num_layers=9,
            device="cpu",
            rescale_with_baseline=False,
        )
        logger.info("BERTScorer loaded successfully.")
    except Exception as exc:
        logger.error(f"Failed to load BERTScorer: {exc}")
        raise RuntimeError(f"Could not load BERTScorer: {exc}") from exc

    yield  # ── server is running ──

    logger.info("Shutting down BERT service.")
    bert_scorer = None


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="BERTScore Similarity Service",
    description="Lightweight microservice to compute BERTScore F1 between a reference and candidate text.",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ScoreRequest(BaseModel):
    reference_text: str
    candidate_text: str


class ScoreResponse(BaseModel):
    f1_score: float
    model_used: str


# ---------------------------------------------------------------------------
# Chunking helper
# ---------------------------------------------------------------------------

def chunk_text_by_tokens(
    tokenizer,
    text: str,
    max_length: int = 256,
    stride: int = 128,
) -> list[str]:
    """
    Tokenize *text* and split it into overlapping windows of *max_length* tokens
    using a sliding window with *stride* step.

    Returns a list of decoded string chunks. If the text fits within *max_length*
    tokens the list contains only the original text (no chunking needed).

    PhoBERT max = 256 tokens. With stride=128 a 1 000-token reference produces
    ~7 chunks — all of which are scored and averaged.
    """
    encoding = tokenizer(
        text,
        add_special_tokens=False,
        return_attention_mask=False,
        return_tensors=None,
    )
    token_ids = encoding["input_ids"]

    if len(token_ids) <= max_length:
        return [text]  # short enough — no chunking needed

    chunks: list[str] = []
    for start in range(0, len(token_ids), stride):
        end = start + max_length
        chunk_ids = token_ids[start:end]
        chunk_str = tokenizer.decode(chunk_ids, skip_special_tokens=True)
        if chunk_str.strip():
            chunks.append(chunk_str)
        if end >= len(token_ids):
            break

    return chunks if chunks else [text]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/healthz", status_code=200, tags=["Health"])
async def health_check():
    """Liveness / readiness probe."""
    if bert_scorer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet.")
    return {"status": "ok", "model_loaded": True, "model_used": MODEL_NAME}


@app.post("/calculate-score", response_model=ScoreResponse, tags=["Scoring"])
async def calculate_score(payload: ScoreRequest):
    """
    Calculate BERTScore F1 between a reference text and a candidate text.

    - **reference_text**: The ground-truth / source text.
    - **candidate_text**: The generated summary or text to evaluate.
    """
    if bert_scorer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet.")

    try:
        logger.info("Computing BERTScore …")

        cand_text = payload.candidate_text
        ref_text = payload.reference_text
        tokenizer = getattr(bert_scorer, "_tokenizer", None)

        if tokenizer is not None:
            # --- Candidate (summary) ---
            # Summaries are short; simple truncation to 256 tokens is fine.
            cand_tokens = tokenizer(cand_text, truncation=True, max_length=256)
            cand_text = tokenizer.decode(cand_tokens["input_ids"], skip_special_tokens=True)

            # --- Reference (original article) ---
            # Articles can be 1 000+ tokens. Instead of discarding everything past
            # token 256 we split into overlapping 256-token chunks (stride = 128),
            # score the candidate against every chunk, then average the F1 scores
            # so the full article contributes to the evaluation.
            ref_chunks = chunk_text_by_tokens(tokenizer, ref_text, max_length=256, stride=128)
        else:
            ref_chunks = [ref_text]

        chunk_count = len(ref_chunks)
        logger.info(f"Reference split into {chunk_count} chunk(s) of ≤256 tokens (stride=128).")

        if chunk_count == 1:
            # Fast path — no chunking needed
            _, _, F1 = bert_scorer.score(cands=[cand_text], refs=[ref_chunks[0]])
            f1_value = round(float(F1[0].item()), 6)
        else:
            # Score candidate against each reference chunk and average
            f1_scores: list[float] = []
            for i, chunk in enumerate(ref_chunks):
                _, _, F1 = bert_scorer.score(cands=[cand_text], refs=[chunk])
                chunk_f1 = float(F1[0].item())
                f1_scores.append(chunk_f1)
                logger.info(f"  chunk {i + 1}/{chunk_count}: F1 = {chunk_f1:.6f}")
            f1_value = round(sum(f1_scores) / len(f1_scores), 6)

        logger.info(f"BERTScore F1 = {f1_value} (avg over {chunk_count} chunk(s))")
        return ScoreResponse(f1_score=f1_value, model_used=MODEL_NAME)
    except Exception as exc:
        logger.exception("Error during BERTScore calculation.")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Local dev entry-point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 7860))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
