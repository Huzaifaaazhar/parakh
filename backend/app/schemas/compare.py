from pydantic import BaseModel, Field, model_validator

from app.schemas.product import ProductOut


class CompareRequest(BaseModel):
    product_id: int | None = None
    product_ids: list[int] | None = Field(default=None, max_length=6)
    limit: int = Field(default=12, ge=1, le=50)
    cheaper_only: bool = False
    other_brands_only: bool = True

    @model_validator(mode="after")
    def _need_input(self):
        if not self.product_id and not self.product_ids:
            raise ValueError("Provide product_id (find alternatives) or product_ids (side-by-side)")
        return self


class Alternative(BaseModel):
    product: ProductOut
    similarity: float
    match_type: str  # same_product | similar
    price_difference: float  # alternative - base (negative = cheaper)
    price_difference_pct: float
    is_cheaper: bool
    shared_features: list[str]
    differences: list[str]


class CompareResponse(BaseModel):
    base: ProductOut
    alternatives: list[Alternative]
    cheapest: ProductOut | None = None
    best_value: ProductOut | None = None
    summary: str


class SideBySideRow(BaseModel):
    attribute: str
    values: list[str | None]
    best_index: int | None = None


class SideBySideResponse(BaseModel):
    products: list[ProductOut]
    rows: list[SideBySideRow]
    summary: str
