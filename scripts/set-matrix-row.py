import csv, sys, io

row_id, ours, note, evidence = sys.argv[1:5]
path = "billing-roadmap-matrix.csv"
raw = open(path, encoding="utf-8", newline="").read()
rows = list(csv.reader(io.StringIO(raw, newline="")))
head = rows[0]
for r in rows[1:]:
    if r[0] == row_id:
        r[head.index("ours")] = ours
        r[head.index("ours_note")] = note
        r[head.index("evidence")] = evidence
        break
else:
    sys.exit(f"no row {row_id}")
out = io.StringIO(newline="")
csv.writer(out, lineterminator="\n").writerows(rows)
open(path, "w", encoding="utf-8", newline="").write(out.getvalue())
