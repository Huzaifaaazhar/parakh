from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import Notification, Product, User, WishlistItem
from app.schemas.user import LoginRequest, NotificationOut, Token, UserCreate, UserOut, WishlistCreate, WishlistOut

router = APIRouter()


def _token(user: User) -> Token:
    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/auth/register", response_model=Token, status_code=201, tags=["auth"])
def register(body: UserCreate, db: Session = Depends(get_db)):
    user = User(email=body.email.lower(), name=body.name, hashed_password=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered") from None
    return _token(user)


def _authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return user


@router.post("/auth/login", response_model=Token, tags=["auth"])
def login(body: LoginRequest, db: Session = Depends(get_db)):
    return _token(_authenticate(db, body.email, body.password))


@router.post("/auth/token", response_model=Token, tags=["auth"], include_in_schema=False)
def token(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    return _token(_authenticate(db, form.username, form.password))


@router.get("/auth/me", response_model=UserOut, tags=["auth"])
def me(user: User = Depends(get_current_user)):
    return user


@router.get("/wishlist", response_model=list[WishlistOut], tags=["wishlist"])
def list_wishlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(WishlistItem).where(WishlistItem.user_id == user.id).order_by(WishlistItem.created_at.desc())).unique().all()


@router.post("/wishlist", response_model=WishlistOut, status_code=201, tags=["wishlist"])
def add_wishlist(body: WishlistCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.get(Product, body.product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    item = db.scalar(select(WishlistItem).where(WishlistItem.user_id == user.id, WishlistItem.product_id == body.product_id))
    if item:
        item.target_price = body.target_price
    else:
        item = WishlistItem(user_id=user.id, product_id=body.product_id, target_price=body.target_price)
        db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/wishlist/{product_id}", status_code=204, tags=["wishlist"])
def remove_wishlist(product_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.scalar(select(WishlistItem).where(WishlistItem.user_id == user.id, WishlistItem.product_id == product_id))
    if item:
        db.delete(item)
        db.commit()


@router.get("/notifications", response_model=list[NotificationOut], tags=["notifications"])
def notifications(unread_only: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    return db.scalars(stmt.order_by(Notification.created_at.desc()).limit(100)).all()


@router.post("/notifications/read", status_code=204, tags=["notifications"])
def mark_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))):
        n.is_read = True
    db.commit()
