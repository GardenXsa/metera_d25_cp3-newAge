import sys
p = open(r"C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21-111\metera-modkit\modkit\cli.py", encoding="utf-8").read()
idx = p.find('p_run = sub.add_parser("run"')
print(p[idx:idx+1500])
