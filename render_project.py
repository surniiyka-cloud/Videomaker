#!/usr/bin/env python3
"""Render Videomaker_for_ChatGPT.zip to H.264 MP4 with FFmpeg.

Uses only Python stdlib + ffmpeg installed on PATH. This is a deterministic
rendering engine, not semantic AI video editing. Browser-generated recommendations
and manually adjusted trim / transitions / zoom are applied as provided.
"""
import argparse
import json
import math
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path


def safe_number(x, default):
    try:
        n = float(x)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def render(archive: Path, output: Path, width=1920, height=1080, fps=24, crf=18):
    if not shutil.which('ffmpeg'):
        raise RuntimeError('FFmpeg не найден в PATH. Установите FFmpeg.')
    with tempfile.TemporaryDirectory(prefix='videomaker_') as tmp:
        folder = Path(tmp)
        with zipfile.ZipFile(archive) as z:
            members = z.namelist()
            if 'project.json' not in members:
                raise ValueError('Нет project.json в ZIP-пакете')
            project = json.loads(z.read('project.json'))
            if project.get('format') != 'videomaker-chatgpt-package-v1':
                raise ValueError('Неподдерживаемый формат проекта')
            clips = project.get('clips', [])
            assets = {x['id']: x for x in project.get('assets', [])}
            if not clips:
                raise ValueError('В проекте нет клипов')
            # Avoid extracting unreferenced paths or unsafe ZIP names.
            needed = {assets[c['assetId']]['filename'] for c in clips}
            music_name = project.get('musicArchiveName')
            if music_name:
                needed.add(music_name)
            for name in needed:
                if name not in members or not (name.startswith('assets/') or name.startswith('music.')):
                    raise ValueError(f'Некорректный путь исходника: {name}')
                destination = folder / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with z.open(name) as src, destination.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
        inputs = []
        for c in clips:
            inputs += ['-i', str(folder / assets[c['assetId']]['filename'])]
        has_music = bool(music_name)
        if has_music:
            inputs += ['-i', str(folder / music_name)]
        chains = []
        durations = []
        for i, c in enumerate(clips):
            start = max(0.0, safe_number(c.get('in'), 0))
            end = safe_number(c.get('out'), start + 1)
            if end - start < .13:
                raise ValueError(f'Слишком короткий клип {i+1}')
            duration = end - start
            durations.append(duration)
            chain = (f'[{i}:v]trim=start={start:.5f}:end={end:.5f},'
                     f'setpts=PTS-STARTPTS,fps={fps},'
                     f'scale={width}:{height}:force_original_aspect_ratio=increase,'
                     f'crop={width}:{height},setsar=1')
            zoom = max(1, min(4, safe_number(c.get('zoomEnd'), 1)))
            if zoom > 1.001:
                seconds = min(duration, max(.1, safe_number(c.get('zoomSeconds'), 1)))
                anchor = min(1, max(0, safe_number(c.get('zoomAnchor'), 50)/100))
                frames = max(1, int(round(duration*fps)))
                first = max(0, frames - int(round(seconds*fps)))
                span = max(1, frames-first)
                # zoompan's on is the output frame number. Smoothstep avoids a jump.
                t = f'min(1,max(0,(on-{first})/{span}))'
                z = f'1+{zoom-1:.5f}*({t}*{t}*(3-2*{t}))'
                chain += (f",zoompan=z='{z}':"
                          f"x='(iw-iw/zoom)*{anchor:.4f}':"
                          f"y='(ih-ih/zoom)/2':d=1:s={width}x{height}:fps={fps}")
            # Approximate browser CSS grade in FFmpeg. Browser sepia is not an exact
            # match to colorbalance; defaults are neutral and backward-compatible.
            brightness = max(.75, min(1.25, safe_number(c.get('gradeBrightness'), 1)))
            contrast = max(.75, min(1.25, safe_number(c.get('gradeContrast'), 1)))
            saturation = max(.5, min(1.5, safe_number(c.get('gradeSaturation'), 1)))
            warmth = max(0, min(.35, safe_number(c.get('gradeWarmth'), 0)))
            if abs(brightness-1)>.001 or abs(contrast-1)>.001 or abs(saturation-1)>.001:
                chain += (f',eq=brightness={(brightness-1)*.7:.4f}:'
                          f'contrast={contrast:.4f}:saturation={saturation:.4f}')
            if warmth>.001:
                chain += f',colorbalance=rs={warmth*.25:.4f}:bs={-warmth*.25:.4f}'
            chain += f',format=yuv420p[v{i}]'
            chains.append(chain)
        last = 'v0'
        elapsed = durations[0]
        for i in range(1, len(clips)):
            prev = clips[i-1]
            is_dissolve = prev.get('kind') == 'dissolve'
            overlap = min(safe_number(prev.get('transition'), .3), durations[i-1]*.45, durations[i]*.45) if is_dissolve else 0.0
            # Tiny xfade for cuts works as a hard cut visually, within 1 frame.
            ov = max(1/fps, overlap)
            offset = max(0, elapsed-ov)
            label = f'm{i}'
            chains.append(f'[{last}][v{i}]xfade=transition=fade:duration={ov:.5f}:offset={offset:.5f}[{label}]')
            last = label
            elapsed += durations[i] - ov
        total = elapsed
        chains.append(f'[{last}]format=yuv420p[vout]')
        if has_music:
            # Pad a short soundtrack with silence rather than cutting off the movie.
            chains.append(f'[{len(clips)}:a]aresample=48000,apad,atrim=duration={total:.5f},asetpts=PTS-STARTPTS[music]')
        filters = folder/'filter.txt'
        filters.write_text(';\n'.join(chains), encoding='utf-8')
        output.parent.mkdir(parents=True, exist_ok=True)
        cmd = ['ffmpeg','-hide_banner','-y',*inputs,'-filter_complex_script',str(filters),'-map','[vout]']
        if has_music:
            cmd += ['-map','[music]','-c:a','aac','-b:a','256k']
        cmd += ['-c:v','libx264','-preset','medium','-crf',str(crf),'-pix_fmt','yuv420p',
                '-r',str(fps),'-t',f'{total:.5f}','-movflags','+faststart',str(output)]
        subprocess.run(cmd,check=True)
        return {'output':str(output),'duration':round(total,3),'clips':len(clips)}


def main():
    p=argparse.ArgumentParser(description='Videomaker: export ChatGPT source package to MP4')
    p.add_argument('package',type=Path,help='Videomaker_for_ChatGPT.zip')
    p.add_argument('-o','--output',type=Path,default=Path('videomaker_final.mp4'))
    p.add_argument('--width',type=int,default=1920)
    p.add_argument('--height',type=int,default=1080)
    p.add_argument('--fps',type=int,default=24)
    p.add_argument('--crf',type=int,default=18)
    args=p.parse_args()
    print(json.dumps(render(args.package,args.output,args.width,args.height,args.fps,args.crf),ensure_ascii=False))

if __name__=='__main__':
    main()
