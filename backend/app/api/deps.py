from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def get_optional_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User | None:
    if not token:
        return None
    sub = decode_access_token(token)
    if not sub or not sub.isdigit():
        return None
    user = db.get(User, int(sub))
    return user if user and user.is_active else None


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    """Admin endpoints (scrapes, banner ads) take the server secret in an X-Admin-Key header."""
    if x_admin_key != settings.secret_key:
        raise HTTPException(status_code=403, detail="Admin key required")
