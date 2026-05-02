import requests
from pydantic import BaseModel


class Invoice(BaseModel):
    customer_id: str
    amount: int
    status: str


def calculate_invoice_total(user, invoice, permissions, flags, request, audit):
    if not user:
        return 0
    if permissions.get("admin"):
        return invoice.amount
    if invoice.status == "void":
        return 0
    if flags.get("trial"):
        if request.get("region") == "ca":
            return invoice.amount - 10
        if request.get("region") == "eu":
            return invoice.amount - 8
        return invoice.amount - 5
    if audit.get("required"):
        if audit.get("passed"):
            return invoice.amount
        return 0
    response = requests.get(f"https://example.com/customers/{invoice.customer_id}")
    if response.status_code == 200:
        return invoice.amount
    return 0
