import csv, subprocess, sys, json, os

prio = sys.argv[1]
mapfile = ".audit/issues.tsv"
done = {}
if os.path.exists(mapfile):
    for line in open(mapfile, encoding="utf-8"):
        k, n = line.rstrip("\n").split("\t")
        done[k] = n

for x in csv.DictReader(open("billing-roadmap-matrix.csv", encoding="utf-8")):
    if x["team_decision"] != "build" or x["team_priority"] != prio or x["id"] in done:
        continue
    body = (
        f"Matrix row `{x['id']}` ({x['area']}), effort {x['effort']}, value {x['value']}.\n\n"
        f"**Today ({x['ours']}).** {x['ours_note'] or 'Nothing built.'} Evidence: `{x['evidence'] or 'none'}`\n\n"
        f"**Recommendation.** {x['rationale']}\n\n"
        f"**Team notes.** {x['notes'].strip() or 'none'}\n\n"
        f"**Done when.** A spec at the evidence path passes in CI and the matrix row's `ours` cell reads `built`."
    )
    out = subprocess.run(
        ["gh", "issue", "create", "--title", f"[{prio}] {x['capability']} ({x['id']})",
         "--body", body, "--label", "enhancement", "--label", f"roadmap:{prio}"],
        capture_output=True, text=True, check=True).stdout.strip()
    num = out.rsplit("/", 1)[1]
    with open(mapfile, "a", encoding="utf-8") as f:
        f.write(f"{x['id']}\t{num}\n")
    print(x["id"], num)
