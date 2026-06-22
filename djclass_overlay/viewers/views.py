from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def link_page(request):
    # Full V-ARCHIVE linking lands in Plan 7 (needs the V-ARCHIVE client + sync).
    return render(request, "pages/link_placeholder.html")
