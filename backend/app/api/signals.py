from fastapi import APIRouter

router = APIRouter()


@router.post("/train")
def train_model() -> dict:
    # Phase 3: train XGBoost on 5yr daily features for shortlisted stocks
    return {"status": "not_implemented", "phase": 3}


@router.post("/predict")
def predict() -> dict:
    # Phase 3: generate buy/sell/hold signals
    return {"status": "not_implemented", "phase": 3}


@router.get("/signals")
def get_signals() -> dict:
    # Phase 3: return stored signals
    return {"status": "not_implemented", "phase": 3}
