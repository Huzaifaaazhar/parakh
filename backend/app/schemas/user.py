from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.product import ProductOut


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=160)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str | None = None
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class WishlistCreate(BaseModel):
    product_id: int
    target_price: float | None = Field(default=None, gt=0)


class WishlistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product: ProductOut
    target_price: float | None = None
    notify: bool
    created_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None
    kind: str
    message: str
    is_read: bool
    created_at: datetime
