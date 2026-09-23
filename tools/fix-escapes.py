# Replace invisible or dangerous characters in JS sources with backslash-u escapes.
# Line/paragraph separators break regex literals; BOM, NBSP, zero-width and combining marks are invisible.
import pathlib, sys
BS = chr(92)
def danger(c):
    o = ord(c)
    return o in (0x2028, 0x2029, 0xFEFF, 0x00A0, 0x200B, 0x200C, 0x200D) or 0x0300 <= o <= 0x036F
changed = []
for base in sys.argv[1:] or ['js', 'tests', 'tools']:
    for p in pathlib.Path(base).rglob('*.js'):
        s = p.read_text(encoding='utf-8')
        t = ''.join((BS + 'u%04x' % ord(c)) if danger(c) else c for c in s)
        if t != s:
            p.write_text(t, encoding='utf-8', newline='')
            changed.append(str(p))
print('\n'.join(changed) or 'nothing to fix')
