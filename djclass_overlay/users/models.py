from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, chzzk_id, chzzk_nickname="", **extra):
        if not chzzk_id:
            raise ValueError("chzzk_id is required")
        user = self.model(chzzk_id=chzzk_id, chzzk_nickname=chzzk_nickname, **extra)
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(
        self, chzzk_id, chzzk_nickname="admin", password=None, **extra
    ):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        user = self.model(chzzk_id=chzzk_id, chzzk_nickname=chzzk_nickname, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    chzzk_id = models.CharField(max_length=64, unique=True)
    chzzk_nickname = models.CharField(max_length=255)
    preferred_button = models.PositiveSmallIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "chzzk_id"
    REQUIRED_FIELDS = ["chzzk_nickname"]
    objects = UserManager()

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.chzzk_nickname
