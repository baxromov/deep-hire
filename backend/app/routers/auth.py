"""Authentication router — login/password + JWT."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_current_user, require_admin
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.services import auth_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _to_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        is_active=user.is_active,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin):
    user = await auth_service.authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    token = auth_service.create_access_token(str(user.id), user.role)
    return TokenResponse(access_token=token, user=_to_response(user))


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return _to_response(current_user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
):
    if not auth_service.verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Текущий пароль неверен")
    current_user.hashed_password = auth_service.hash_password(body.new_password)
    current_user.updated_at = datetime.utcnow()
    await current_user.save()
    return {"ok": True}


# ── Admin: user management ────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
async def list_users(_: User = Depends(require_admin)):
    users = await User.find_all().to_list()
    return [_to_response(u) for u in users]


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(body: UserCreate, _: User = Depends(require_admin)):
    existing = await User.find_one(User.username == body.username)
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь с таким именем уже существует")
    user = User(
        username=body.username,
        email=body.email,
        hashed_password=auth_service.hash_password(body.password),
        role=body.role,
        full_name=body.full_name,
    )
    await user.insert()
    return _to_response(user)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    body: dict,
    _: User = Depends(require_admin),
):
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    allowed = {"email", "full_name", "role", "is_active"}
    for key, value in body.items():
        if key in allowed:
            setattr(user, key, value)

    if "password" in body:
        user.hashed_password = auth_service.hash_password(body["password"])

    user.updated_at = datetime.utcnow()
    await user.save()
    return _to_response(user)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, current_admin: User = Depends(require_admin)):
    if str(current_admin.id) == user_id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    await user.delete()
