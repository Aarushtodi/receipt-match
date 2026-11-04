"""Render a fake Whole Foods style receipt as sample_receipt.png for OCR testing."""
from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 40)
W, PAD, LH = 1000, 60, 64
COLS = 34  # characters per line at this font size

def row(left, right=""):
    return left + " " * max(1, COLS - len(left) - len(right)) + right

lines = [
    "WHOLE FOODS MARKET".center(COLS),
    "123 MAIN ST AUSTIN TX".center(COLS),
    "(512) 555-0142".center(COLS),
    "",
    "10/29/2026          5:42 PM",
    "",
    row("ORGANIC BANANAS", "2.49"),
    row("365 ALMOND MILK", "3.99"),
    row("SALMON FILLET", "18.74"),
    row("BABY SPINACH", "4.99"),
    row("SOURDOUGH BREAD", "6.49"),
    row("GREEK YOGURT", "13.98"),
    "",
    row("SUBTOTAL", "50.68"),
    row("TAX", "3.69"),
    row("TOTAL", "54.37"),
    "",
    row("VISA **** 4821", "54.37"),
    "",
    "THANK YOU FOR SHOPPING".center(COLS),
]

H = PAD * 2 + LH * len(lines)
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)
for i, text in enumerate(lines):
    d.text((PAD, PAD + i * LH), text, font=FONT, fill=0)
img.save("sample_receipt.png")
print("wrote sample_receipt.png", img.size)
