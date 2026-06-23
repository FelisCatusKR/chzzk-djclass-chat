from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import render


def landing(request: HttpRequest) -> HttpResponse:
    return render(request, "pages/landing.html")
