# One Arabic per English key across all area files (coordinator choices, 30 Oct 2026).
import os, re, json, glob
D = "lib/i18n/ar"
files = [f for f in glob.glob(f"{D}/*.js") if not f.endswith("index.js")]
pat = re.compile(r'^(\s*)("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*$', re.M)
vals = {}
for f in files:
    for m in pat.finditer(open(f).read()):
        vals.setdefault(json.loads(m.group(2)), {})[os.path.basename(f)[:-3]] = json.loads(m.group(3))
chosen = {
 "Please confirm the cash has been received.": "يرجى تأكيد استلام الكاش.",
 "Items returned": "أصناف مرتجعة", "Direct (empty)": "رسالة مباشرة (فارغة)", "Walk-in": "بدون تحويل",
 "Checking Paymob...": "جاري التحقق من Paymob...", "Continue to Profile": "متابعة إلى الملف",
 "Nothing pending.": "لا يوجد شيء قيد الانتظار.", "Pending": "قيد الانتظار", "What is this for?": "ما الغرض من هذا الطلب؟",
 "Needed by {date}": "مطلوب بحلول {date}", "Picked up at reception": "استلام من الاستقبال",
 "No referrals yet.": "لا توجد تحويلات بعد.", "{n} visits": "{n} زيارة", "Report Done": "تم التقرير", "Visit": "زيارة",
 "Out of stock": "غير متوفر", "Submitted {date}": "تم الإرسال {date}",
}
fixed = 0
for key, per in vals.items():
    if len(set(per.values())) < 2: continue
    v = chosen.get(key) or per.get("errors") or per.get("common") or per.get("codes") or sorted(per.items())[0][1]
    chosen[key] = v
for f in files:
    s = open(f).read()
    def rep(m):
        global fixed
        k = json.loads(m.group(2))
        if k in chosen and json.loads(m.group(3)) != chosen[k]:
            fixed += 1
            return f'{m.group(1)}{m.group(2)}: {json.dumps(chosen[k], ensure_ascii=False)},'
        return m.group(0)
    open(f, "w").write(pat.sub(rep, s))
print("values aligned:", fixed)
