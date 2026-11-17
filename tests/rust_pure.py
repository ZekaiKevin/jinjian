#!/usr/bin/env python3
# 在没有 Tauri 依赖、拉不到 crates 的环境里跑 main.rs 的纯逻辑测试（0.9.0）。
# 做法：把 main.rs 里不碰 Tauri / 系统的那几个函数和 `mod tests` 原样抠出来，配一个只用标准库的 is_json 替身，
# 用 rustc --test 编一个小程序跑。真正的 `cargo test` 在 CI（windows job，打包之前）里跑，以 CI 为准。
#   python3 tests/rust_pure.py
# main.rs 里新加了纯函数、测试里用到了，把它的名字加到下面 NAMES 里。
import os, re, subprocess, sys, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src=open(os.path.join(ROOT, 'src-tauri', 'src', 'main.rs'), encoding='utf-8').read()
def match_brace(i):
    # i 指向 '{'；跳过字符串、原始字符串、字符、注释
    depth=0; j=i; n=len(src)
    while j<n:
        c=src[j]
        if src.startswith('//',j): j=src.index('\n',j); continue
        m=re.match(r'r(#*)"',src[j:]) if c=='r' and (j==0 or not (src[j-1].isalnum() or src[j-1]=='_')) else None
        if m:
            end='"'+m.group(1); j=src.index(end,j+len(m.group(0)))+len(end); continue
        if c=='"':
            j+=1
            while src[j]!='"':
                j+= 2 if src[j]=='\\' else 1
            j+=1; continue
        if c=="'":
            m=re.match(r"'(\\.[^']*|[^\\'])'",src[j:])
            if m: j+=len(m.group(0)); continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0: return j
        j+=1
    raise Exception('unbalanced')
def block(pat):
    m=re.search(pat, src, re.M); assert m, pat
    k=m.start()
    lines=src[:k].split('\n'); lines.pop() if lines and lines[-1]=='' else None
    pre=[]
    while lines and (lines[-1].strip().startswith('#[') or lines[-1].strip().startswith('///')):
        pre.insert(0,lines.pop())
    i=src.index('{',k)
    return '\n'.join(pre)+'\n'+src[k:match_brace(i)+1]+'\n'
out=['#![allow(dead_code)]','use std::{fs, io::Write, path::{Path, PathBuf}, thread, time::Duration};',
 'const WINDOW_WIDTH: f64 = 928.0;','const EDGE_BAND: f64 = 3.0;','const EDGE_PEEK_MS: u64 = 220;','const EDGE_LEAVE_MS: u64 = 900;','const EDGE_ASK_MS: u64 = 2000;',
 r'''fn is_json(text: &str) -> bool {
    let t = text.trim();
    if !(t.starts_with('{') && t.ends_with('}')) { return false; }
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for c in t.chars() {
        if in_str { if esc { esc = false } else if c == '\\' { esc = true } else if c == '"' { in_str = false } continue; }
        match c { '"' => in_str = true, '{' | '[' => depth += 1, '}' | ']' => depth -= 1, _ => {} }
        if depth < 0 { return false; }
    }
    depth == 0 && !in_str
}''']
NAMES = [r'^fn label_ok\(', r'^fn read_with_backup\(', r'^fn write_atomic\(', r'^fn finish_pending\(', r'^fn safe_name\(', r'^fn free_path\(', r'^fn wall_style\(',
            r'^struct WallSig ', r'^fn place_rect\(', r'^fn at_edge\(', r'^enum EdgeCmd ', r'^struct Edge ', r'^impl Edge ', r'^fn tick_ms\(', r'^fn approved_on\(', r'^fn center_in\(', r'^fn icloud_host\(',
            r'^mod tests ']
for pat in NAMES:
    out.append(block(pat))
tmp = tempfile.mkdtemp(prefix='jinjian-rust-')
rs = os.path.join(tmp, 'harness.rs')
open(rs, 'w', encoding='utf-8').write('\n'.join(out))
exe = os.path.join(tmp, 'harness')
if subprocess.call(['rustc', '--edition', '2021', '--test', '-A', 'warnings', rs, '-o', exe]) != 0:
    sys.exit(1)
sys.exit(subprocess.call([exe]))
