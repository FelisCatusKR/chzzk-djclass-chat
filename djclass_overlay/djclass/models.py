from django.conf import settings
from django.db import models


class DjClass(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    button = models.PositiveSmallIntegerField()
    dj_class = models.CharField(max_length=64)
    dj_power_sum = models.FloatField(null=True, blank=True)
    max_dj_power = models.FloatField(null=True, blank=True)
    dj_power_conversion = models.FloatField(null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dj_classes"
        constraints = [
            models.UniqueConstraint(fields=["user", "button"], name="uniq_user_button"),
            models.CheckConstraint(
                condition=models.Q(button__in=[4, 5, 6, 8]), name="button_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.button}B {self.dj_class}"
