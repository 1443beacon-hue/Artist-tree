"""Build the editable Artistree presentation and matching PDF handout.

Run in an isolated Python environment with python-pptx, Pillow and reportlab.
The PDF uses a locally available Korean-capable font; set ARTISTREE_PDF_FONT
when building on a different machine. App source files are never modified.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from zipfile import ZipFile

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
W, H = 13.333333, 7.5
BG, INK, BLUE = "F7F7F2", "242620", "3155E7"
SAGE, LINE, WHITE, PALE = "65715B", "E2E3DA", "FCFCF8", "EDF0FC"
FONT_KO, FONT_LATIN = "Apple SD Gothic Neo", "Helvetica Neue"
PDF_FONT = os.environ.get("ARTISTREE_PDF_FONT", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
pdfmetrics.registerFont(TTFont("Korean", PDF_FONT))

SLIDES: list[dict] = []
WARNINGS: list[str] = []


def scene(section, title, note, *, title_size=34):
    s = {"section": section, "title": title, "note": note, "items": []}
    SLIDES.append(s)
    text(s, "artistree.", .65, .38, 2.4, 22, bold=True)
    text(s, section, 3.2, .49, 8.8, 10, color=SAGE)
    line(s, .65, .94, 12.68, .94, color=LINE)
    if title:
        text(s, title, .7, 1.22, 12, title_size, bold=True)
    return s


def text(s, value, x, y, w, size=20, color=INK, bold=False, align="left", leading=1.28):
    lines = value.split("\n")
    h = len(lines) * size / 72 * leading + .07
    s["items"].append(dict(kind="text", value=value, x=x, y=y, w=w, h=h, size=size,
                           color=color, bold=bold, align=align, leading=leading))


def rect(s, x, y, w, h, fill=WHITE, stroke=LINE, radius=.12):
    s["items"].append(dict(kind="rect", x=x, y=y, w=w, h=h, fill=fill, stroke=stroke, radius=radius))


def circle(s, x, y, d, fill=WHITE, stroke=LINE):
    s["items"].append(dict(kind="circle", x=x, y=y, w=d, h=d, fill=fill, stroke=stroke))


def line(s, x1, y1, x2, y2, color=LINE, weight=1):
    s["items"].append(dict(kind="line", x=x1, y=y1, x2=x2, y2=y2, color=color, weight=weight))


def picture(s, name, x, y, w, h=None):
    path = ASSETS / name
    iw, ih = Image.open(path).size
    h = h if h is not None else w * ih / iw
    s["items"].append(dict(kind="image", path=str(path), x=x, y=y, w=w, h=h))


def pill(s, value, x, y, w, fill=PALE, color=BLUE, size=13):
    rect(s, x, y, w, .43, fill=fill, stroke=None, radius=.16)
    text(s, value, x+.1, y+.095, w-.2, size, color=color, align="center")


def footer(s, index):
    line(s, .65, 7.05, 12.68, 7.05, color=LINE)
    text(s, "ARTISTREE  /  PROJECT PRESENTATION", .7, 7.18, 8, 9, color=SAGE)
    text(s, f"{index:02d} / 10", 11.8, 7.16, .8, 10, color=SAGE, align="right")


# 01 — An editable vector network is a conceptual cover illustration, not data.
s = scene("MUSIC DISCOVERY, THROUGH PEOPLE", "", (
    "안녕하세요. Artistree는 좋아하는 아티스트 한 명에서 시작해, 그 사람이 누구와 음악을 "
    "만들었는지 따라가며 새로운 음악을 발견하는 웹 프로젝트입니다. 추천 목록을 받아보는 "
    "것보다 직접 연결을 탐험하는 경험을 만들고 싶었습니다. 오늘은 기술의 세부 구조보다, "
    "실제로 어떻게 사용하는지와 제가 요청하며 어떤 방향으로 발전시켰는지를 중심으로 "
    "소개하겠습니다. 표지의 네트워크는 개념을 표현한 장식 도식입니다."
))
text(s, "artistree.", .68, 1.75, 7.8, 80, bold=True)
text(s, "음악은 사람으로 이어진다.", .75, 3.27, 8.0, 31, bold=True)
text(s, "아티스트의 실제 작업 관계를 따라\n새로운 음악을 발견하는 웹 프로젝트", .77, 4.08, 7.6, 21, color=SAGE)
pill(s, "SEARCH", .77, 5.64, 1.6)
pill(s, "EXPLORE", 2.55, 5.64, 1.85)
pill(s, "LISTEN", 4.58, 5.64, 1.6)
points = [(9.25, 2.15, .54), (11.62, 1.72, .35), (10.35, 3.6, .94),
          (8.48, 4.65, .48), (12.05, 4.65, .42), (10.55, 5.63, .37)]
for a, b in [(0, 1), (0, 2), (1, 2), (2, 3), (2, 4), (2, 5)]:
    p, q = points[a], points[b]
    line(s, p[0]+p[2]/2, p[1]+p[2]/2, q[0]+q[2]/2, q[1]+q[2]/2, color="A8B4D3", weight=1.5)
for i, (x, y, d) in enumerate(points):
    circle(s, x, y, d, fill=BLUE if i == 2 else "E8EDDF", stroke=BLUE if i == 2 else "BEC9B1")
circle(s, 10.23, 3.48, 1.18, fill=None, stroke="B6C2ED")

# 02
s = scene("01  /  WHY", "이 아티스트는 누구와 작업했을까?", (
    "프로젝트의 출발점은 간단한 궁금증이었습니다. 좋아하는 음악을 듣다 보면 이 아티스트가 "
    "어떤 프로듀서와 작업했고, 또 어떤 인물과 연결되는지 궁금해집니다. 그래서 곡을 일렬로 "
    "나열하는 대신, 아티스트를 점으로, 확인된 관계를 선으로 표현했습니다. 사용자가 연결을 "
    "직접 따라가면서 새로운 인물과 곡을 발견하는 것이 Artistree의 핵심입니다. 모든 관계나 "
    "모든 곡을 보여주는 서비스라는 뜻은 아닙니다."
))
text(s, "목록을 받는 대신,\n연결을 직접 따라간다.", .8, 2.34, 7.0, 32, bold=True)
text(s, "누구와 함께했는지 보고,\n어떤 곡으로 이어지는지 이해하는 탐색.", .83, 4.1, 7.0, 20, color=SAGE)
rect(s, 8.55, 2.22, 3.95, 3.78)
for y, number, head, body in [
    (2.62, "01", "사람", "좋아하는 아티스트에서 시작"),
    (3.72, "02", "관계", "확인된 작업 연결을 따라가기"),
    (4.82, "03", "곡", "함께 만든 음악의 맥락 발견"),
]:
    text(s, number, 8.9, y, .45, 12, color=BLUE)
    text(s, head, 9.5, y-.02, 2.55, 23, bold=True)
    text(s, body, 9.5, y+.42, 2.75, 12, color=SAGE)

# 03
s = scene("02  /  HOW IT WORKS", "한 명을 고르고, 연결을 따라간다.", (
    "사용 방법은 세 단계입니다. 먼저 아티스트를 검색해서 지도에 한 명을 놓습니다. 검색만으로 "
    "지도가 자동으로 커지지는 않습니다. 그 인물을 클릭하면 새로 추가되는 사람을 최대 네 명씩 "
    "보여줍니다. 마음에 드는 인물을 계속 선택하면 가지가 이어집니다. 마지막으로 커서를 올려 "
    "함께한 곡과 참여자 그룹을 보고, 원하면 미리듣기 패널로 넘어갑니다. 오른쪽은 실제 개발 "
    "화면입니다. 실시간 외부 응답에 따라 보이는 인물과 순서는 달라질 수 있습니다."
))
for y, number, head, body in [
    (2.22, "1", "한 명을 검색", "검색 결과를 골라\n탐색의 출발점 만들기"),
    (3.58, "2", "최대 4명씩 확장", "선택한 인물을 중심으로\n조금씩 가지 펼치기"),
    (4.94, "3", "곡과 참여자 확인", "커서로 맥락을 보고\n원하면 미리듣기로 연결"),
]:
    circle(s, .83, y, .44, fill=BLUE, stroke=None)
    text(s, number, .84, y+.08, .42, 14, color=WHITE, bold=True, align="center")
    text(s, head, 1.5, y-.02, 3.4, 22, bold=True)
    text(s, body, 1.5, y+.5, 3.4, 16, color=SAGE)
picture(s, "overview.png", 5.2, 2.15, 7.35)
text(s, "실제 구현 화면  /  검색 → 인물 선택 → 관계 확장", 5.25, 6.77, 7.25, 11, color=SAGE)

# 04
s = scene("03  /  REQUEST → IMPROVEMENT ①", "요청하면서, 지도를 더 자연스럽게.", (
    "개발 과정에서 저는 기능을 많이 넣는 것보다 탐색할 때의 느낌을 중요하게 봤습니다. "
    "한 번에 너무 많은 인물이 나타나지 않도록 최대 네 명씩 펼치고, 클릭한 사람이 중심에 "
    "오되 확대 배율은 유지하도록 개선했습니다. 노드를 끌면 주변이 부드럽게 반응하고, "
    "겹침도 완화하도록 했습니다. 아래 내용은 당시 요청의 취지를 요약한 것입니다. 화면을 "
    "반복해서 확인하며 읽기 쉽고 직접 조작하는 느낌으로 다듬은 과정입니다."
))
text(s, "요청의 취지", 1.02, 2.14, 3.2, 12, color=SAGE)
text(s, "반영한 기능", 4.8, 2.14, 3.4, 12, color=SAGE)
text(s, "달라진 경험", 8.83, 2.14, 3.5, 12, color=SAGE)
for y, a, b, c in [
    (2.55, "한 번에 너무 많지 않게", "최대 4명씩 펼치기", "지도를 천천히 이해"),
    (3.78, "내가 고른 인물이 중심", "중앙 이동 · 배율 유지", "탐색의 기준점 유지"),
    (5.01, "직접 만지는 느낌으로", "드래그 · 탄성 반응", "겹침을 줄이고 자연스럽게"),
]:
    rect(s, .8, y, 11.75, 1.03)
    text(s, a, 1.05, y+.32, 3.5, 18)
    text(s, "→", 4.22, y+.3, .4, 20, color=SAGE)
    text(s, b, 4.82, y+.32, 3.8, 18, color=BLUE, bold=True)
    text(s, c, 8.87, y+.34, 3.4, 16, color=SAGE)
text(s, "기능의 개수보다, 사용자가 따라가는 흐름을 먼저 다듬었다.", .86, 6.48, 11.8, 16)

# 05
s = scene("04  /  REQUEST → IMPROVEMENT ②", "같은 곡은, 같은 그룹으로.", (
    "처음에는 인물에 커서를 올리면 그 사람과 함께한 곡 하나를 보여주는 카드였습니다. "
    "그런데 주변 네 명이 모두 같은 곡에 참여했다면 같은 정보가 반복된다는 점을 발견했습니다. "
    "그래서 저는 같은 곡을 만든 사람들이면 한 번에 보여주자고 요청했습니다. 지금은 그 곡의 "
    "참여가 확인된 지도 속 인물과 연결선이 함께 강조됩니다. 화면의 Obedient 예시에서는 "
    "Bladee, Ecco2k, Whitearmor가 묶입니다. 같은 제목만으로 합치지 않고 실제 곡 식별 정보를 "
    "사용하며, 지도에 없는 전체 참여자를 모두 보여준다는 뜻은 아닙니다."
))
text(s, "처음에는", .84, 2.28, 5.2, 14, color=SAGE)
text(s, "각 인물마다\n같은 곡 카드가 반복", .84, 2.76, 5.2, 27, bold=True)
line(s, .85, 4.04, 5.7, 4.04, color=LINE)
text(s, "요청을 반영한 뒤", .84, 4.38, 5.2, 14, color=BLUE)
text(s, "참여자와 연결선을\n한 번에 강조", .84, 4.85, 5.2, 27, bold=True)
picture(s, "group-hover.png", 7.36, 2.02, 4.35)
text(s, "Obedient  /  Bladee · Ecco2k · Whitearmor", 6.67, 6.51, 5.75, 12, color=SAGE, align="center")
text(s, "현재 지도에 보이며, 해당 곡 참여가 확인된 인물만 묶습니다.", .87, 6.5, 5.7, 12, color=SAGE)

# 06
s = scene("05  /  REQUEST → IMPROVEMENT ③", "발견한 곡을, 바로 들어보기.", (
    "다음 요청은 함께 작업한 곡을 실제로 들어볼 수 있느냐는 것이었습니다. 카드에는 "
    "Open preview 버튼을 넣고, 누르면 오른쪽에 곡 중심 패널이 열리도록 했습니다. 실제 "
    "재생은 공식 플레이어의 재생 버튼을 한 번 더 눌러야 합니다. 커서를 올리는 것만으로 "
    "음악이 나오지는 않습니다. Genius가 곡에 직접 연결한 YouTube 영상은 앞부분 약 30초를 "
    "재생하도록 설정했습니다. 지원되지 않는 곡을 비슷한 다른 곡으로 대체하지 않고 안내합니다. "
    "서비스와 지역에 따라 재생 가능 여부나 미리듣기 길이는 달라질 수 있습니다."
))
for y, number, head in [
    (2.25, "01", "커서를 올려 곡 확인"),
    (3.22, "02", "Open preview로 패널 열기"),
    (4.19, "03", "공식 플레이어에서 ▶ 재생"),
]:
    text(s, number, .85, y+.03, .5, 13, color=BLUE, bold=True)
    text(s, head, 1.55, y, 5.1, 22, bold=True)
text(s, "지원되는 연결 영상은 앞부분 약 30초.\n자동 재생 없이, 출처가 연결한 공식 플레이어 사용.", .88, 5.46, 6.6, 16, color=SAGE)
text(s, "재생 가능 여부와 길이는 서비스·지역에 따라 다릅니다.", .9, 6.45, 7.0, 12, color=SAGE)
picture(s, "hover-card.png", 6.85, 2.4, 2.4)
text(s, "→", 9.37, 3.23, .4, 24, color=BLUE, align="center")
picture(s, "player-panel.png", 9.86, 2.01, 2.55)
text(s, "실제 구현 화면", 9.85, 6.76, 2.65, 11, color=SAGE, align="center")

# 07
s = scene("06  /  REQUEST → IMPROVEMENT ④", "탐색한 길을 잃지 않도록.", (
    "지도가 커지면 내가 어디에서 시작했고 어디를 거쳐 왔는지도 중요해집니다. 그래서 실제로 "
    "따라온 경로를 위쪽에 표시하고 Back으로 이전 상태에 돌아갈 수 있게 했습니다. 마음에 "
    "드는 지도에는 이름을 붙여 저장하고, 같은 브라우저에서 다시 열 수 있습니다. 계정이나 "
    "클라우드 저장은 아닙니다. 또 불러오는 중인지, 확인을 이어가는 중인지, 오류가 났는지를 "
    "구분해서 표시했습니다. 탐색이 커져도 사용자가 현재 상황을 이해할 수 있게 한 개선입니다."
))
pill(s, "시작 인물", 2.28, 2.25, 2.15, fill=WHITE, color=INK, size=16)
text(s, "→", 4.66, 2.3, .45, 20, color=SAGE, align="center")
pill(s, "새 인물", 5.33, 2.25, 2.15, fill=WHITE, color=INK, size=16)
text(s, "→", 7.71, 2.3, .45, 20, color=SAGE, align="center")
pill(s, "다음 인물", 8.38, 2.25, 2.15, size=16)
text(s, "실제 탐색 경로를 따라 돌아가기", 2.3, 2.97, 8.2, 14, color=SAGE, align="center")
for x, head, body in [
    (.83, "돌아가기", "경로와 Back으로\n이전 탐색 상태 복원"),
    (4.93, "저장하기", "지도에 이름을 붙이고\n배치까지 다시 불러오기"),
    (9.03, "상태 알기", "로딩·추가 확인·오류를\n구분해서 안내"),
]:
    rect(s, x, 3.65, 3.5, 2.43)
    text(s, head, x+.27, 4.03, 3, 25, bold=True)
    text(s, body, x+.29, 4.85, 2.95, 17, color=SAGE)
text(s, "지도 저장은 현재 브라우저에만 보관됩니다. 계정·클라우드 기능은 아닙니다.", .88, 6.51, 11.9, 13, color=SAGE)

# 08
s = scene("07  /  TECHNOLOGY, SIMPLY", "기술은 간단하게, 역할은 분명하게.", (
    "기술은 네 가지 역할로 이해하면 쉽습니다. HTML과 CSS, JavaScript는 화면과 조작을 "
    "만들고 SVG는 사람 사이의 연결선을 그립니다. Node.js 서버는 외부 정보와 화면 사이의 "
    "창구입니다. Genius와 MusicBrainz 같은 출처에서 실제 참여 정보를 확인하고, 지도 저장은 "
    "브라우저의 localStorage를 사용합니다. 미리듣기는 음원을 직접 보관하지 않고 공식 "
    "플레이어를 불러오는 방식입니다. Spotify 콘텐츠는 다른 출처와 섞지 않고 별도 화면으로 "
    "분리했습니다. 복잡한 기술 자체보다 각 역할을 통해 어떤 경험을 만들었는지가 핵심입니다."
))
for i, (x, head, stack, body) in enumerate([
    (.8, "화면", "HTML · CSS · JavaScript", "SVG로 사람과\n연결선을 표현"),
    (3.88, "정보 연결", "Node.js", "화면과 외부 출처\n사이의 창구"),
    (6.96, "작업 근거", "Genius · MusicBrainz", "참여 정보와\n출처를 확인"),
    (10.04, "나의 기록", "localStorage", "지도를 현재\n브라우저에 저장"),
]):
    rect(s, x, 2.33, 2.49, 3.13)
    circle(s, x+.26, 2.65, .1, fill=BLUE, stroke=None)
    text(s, head, x+.25, 3.04, 2.05, 23, bold=True)
    text(s, stack, x+.25, 3.68, 2.08, 11, color=BLUE)
    text(s, body, x+.25, 4.25, 2.05, 17, color=SAGE)
rect(s, .82, 5.85, 11.71, .64, fill=PALE, stroke=None)
text(s, "공식 플레이어 임베드  →  음원을 직접 저장하지 않고 재생", 1.12, 6.03, 11.1, 17, color=BLUE, align="center")
text(s, "Spotify는 별도 탐색 화면으로 분리해 운영합니다.", .86, 6.72, 11.8, 11, color=SAGE)

# 09
s = scene("08  /  TRUST & VALIDATION", "보기 좋은 지도, 믿을 수 있는 연결.", (
    "보기 좋게 연결하는 것만큼 근거를 지키는 것도 중요했습니다. 이름이 같다고 같은 인물로 "
    "합치지 않고, 출처가 있는 정보를 사용합니다. 작업·소속·유사성은 서로 구분합니다. 정보는 확인되는 것부터 먼저 "
    "보여주되 로딩이나 실패 상태를 숨기지 않습니다. 발표 자료 작성 시점에는 자동화 테스트 "
    "163개가 통과했고, 수정 전 상태를 체크포인트로 보존했습니다. 이 숫자는 기능 동작을 "
    "검사한 개발 검증 결과이지, 모든 음악 정보가 완벽하거나 실제 사용자 성과가 검증됐다는 "
    "의미는 아닙니다. 현재는 로컬 프로토타입이며 지원 범위에도 한계가 있습니다."
))
for x, head in [(.86, "근거"), (5.0, "응답"), (9.0, "검증")]:
    text(s, head, x, 2.27, 3.4, 14, color=BLUE, bold=True)
line(s, 4.5, 2.3, 4.5, 5.72, color=LINE)
line(s, 8.55, 2.3, 8.55, 5.72, color=LINE)
text(s, "근거 있는\n관계만 표시", .86, 2.93, 3.4, 29, bold=True)
text(s, "이름만 같다고 합치지 않음\n작업·소속·유사성을 구분", .89, 4.57, 3.35, 16, color=SAGE)
text(s, "먼저 보여주고,\n상태는 솔직하게", 5.0, 2.93, 3.42, 26, bold=True)
text(s, "확인된 정보부터 화면에 표시\n로딩과 오류를 구분해서 안내", 5.02, 4.57, 3.35, 16, color=SAGE)
text(s, "163", 9.0, 2.82, 3.1, 68, color=BLUE, bold=True)
text(s, "자동화 테스트 통과\n변경 전 체크포인트 보존", 9.04, 4.57, 3.35, 16, color=SAGE)
rect(s, .82, 6.15, 11.71, .65, fill="EFF1E8", stroke=None)
text(s, "현재는 로컬 프로토타입  /  모든 곡·전체 참여자·전 세계 재생 가능 여부를 보장하지 않음",
     1.03, 6.37, 11.28, 12, color=SAGE, align="center")

# 10
s = scene("09  /  WHAT'S NEXT", "", (
    "Artistree를 한 문장으로 정리하면 추천받는 음악에서 찾아가는 음악으로의 전환입니다. "
    "현재는 한 명에서 시작해 관계를 넓히고, 함께한 곡의 맥락을 이해하고, 지원되는 공식 "
    "플레이어로 듣는 흐름까지 만들었습니다. 앞으로는 서로 다른 곡의 연결을 더 다양하게 "
    "보여주거나, 지도를 공유하거나, 두 아티스트의 접점을 찾는 방향도 생각하고 있습니다. "
    "이 세 가지는 아직 구현된 기능이 아니라 다음 아이디어입니다. 실제 화면을 사용하며 "
    "요청하고 수정한 경험이 프로젝트를 더 구체적으로 만들었다는 점이 가장 큰 배움입니다. "
    "감사합니다."
))
text(s, "추천받는 음악에서,\n찾아가는 음악으로.", .78, 1.75, 9.8, 45, bold=True)
text(s, "지금 구현한 흐름", .85, 3.65, 8.9, 14, color=SAGE)
pill(s, "사람을 탐색", .85, 4.18, 2.6, size=17)
pill(s, "작업 맥락 이해", 3.68, 4.18, 3.1, size=17)
pill(s, "공식 미리듣기", 7.02, 4.18, 3.0, size=17)
line(s, .85, 5.1, 12.4, 5.1, color=LINE)
text(s, "다음 아이디어  ·  아직 미구현", .85, 5.5, 11.5, 13, color=SAGE)
text(s, "다른 곡으로 더 다양하게 탐색  /  지도 공유  /  두 아티스트의 접점 찾기",
     .85, 5.98, 11.7, 19)
text(s, "Q&A", 11.14, 2.64, 1.3, 19, color=BLUE, align="right")


def pdf_font(value, bold=False):
    return "Korean" if any(ord(ch) > 127 for ch in value) else ("Helvetica-Bold" if bold else "Helvetica")


def render_pptx():
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(W), Inches(H)
    props = prs.core_properties
    props.title = "Artistree — 사람으로 이어지는 음악 탐험"
    props.subject = "직관적인 프로젝트 소개와 요구사항 기반 개선"
    props.author = "Artistree"
    props.keywords = "Artistree, 음악 탐색, 아티스트 크레딧, 프로젝트 발표"
    for index, spec in enumerate(SLIDES, 1):
        footer(spec, index)
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor.from_string(BG)
        slide.notes_slide.notes_text_frame.text = spec["note"]
        for item in spec["items"]:
            k = item["kind"]
            x, y = Inches(item["x"]), Inches(item["y"])
            if k == "text":
                box = slide.shapes.add_textbox(x, y, Inches(item["w"]), Inches(item["h"]))
                tf = box.text_frame
                tf.clear()
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                tf.auto_size, tf.word_wrap, tf.vertical_anchor = MSO_AUTO_SIZE.NONE, False, MSO_ANCHOR.TOP
                for n, value in enumerate(item["value"].split("\n")):
                    p = tf.paragraphs[0] if n == 0 else tf.add_paragraph()
                    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[item["align"]]
                    p.space_before = p.space_after = Pt(0)
                    p.line_spacing = Pt(item["size"]*item["leading"])
                    run = p.add_run()
                    run.text = value
                    run.font.name = FONT_KO if any(ord(ch) > 127 for ch in value) else FONT_LATIN
                    run.font.size, run.font.bold = Pt(item["size"]), item["bold"]
                    run.font.color.rgb = RGBColor.from_string(item["color"])
                    # Set explicit East Asian/fallback faces for Korean PowerPoint.
                    for tag, face in [("a:ea", FONT_KO), ("a:cs", FONT_KO)]:
                        font = OxmlElement(tag); font.set("typeface", face)
                        run._r.get_or_add_rPr().append(font)
            elif k == "line":
                sh = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x, y, Inches(item["x2"]), Inches(item["y2"]))
                sh.line.color.rgb = RGBColor.from_string(item["color"])
                sh.line.width = Pt(item["weight"])
            elif k == "image":
                sh = slide.shapes.add_picture(item["path"], x, y, Inches(item["w"]), Inches(item["h"]))
                sh.name = Path(item["path"]).stem
            else:
                shape = MSO_AUTO_SHAPE_TYPE.OVAL if k == "circle" else MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE
                sh = slide.shapes.add_shape(shape, x, y, Inches(item["w"]), Inches(item["h"]))
                if k == "rect":
                    sh.adjustments[0] = min(.14, item["radius"]/max(.01, min(item["w"], item["h"])))
                if item["fill"]:
                    sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor.from_string(item["fill"])
                else:
                    sh.fill.background()
                if item["stroke"]:
                    sh.line.color.rgb = RGBColor.from_string(item["stroke"]); sh.line.width = Pt(.8)
                else:
                    sh.line.fill.background()
    path = ROOT / "Artistree_Project_Presentation.pptx"
    prs.save(path)
    return path


def render_pdf():
    path = ROOT / "Artistree_Project_Presentation.pdf"
    pdf = Canvas(str(path), pagesize=(W*72, H*72), pageCompression=1)
    pdf.setTitle("Artistree — 사람으로 이어지는 음악 탐험")
    pdf.setAuthor("Artistree")
    for spec in SLIDES:
        pdf.setFillColor(HexColor("#"+BG)); pdf.rect(0, 0, W*72, H*72, fill=1, stroke=0)
        for item in spec["items"]:
            k = item["kind"]; x, y = item["x"]*72, (H-item["y"])*72
            if k == "text":
                pdf.setFillColor(HexColor("#"+item["color"]))
                for i, value in enumerate(item["value"].split("\n")):
                    font = pdf_font(value, item["bold"])
                    width = pdfmetrics.stringWidth(value, font, item["size"])
                    if width > item["w"]*72+1:
                        WARNINGS.append(f"{spec['title']}: text width {width/72:.2f} > {item['w']}: {value}")
                    pdf.setFont(font, item["size"])
                    xp = x if item["align"] == "left" else x+(item["w"]*72-width)/2 if item["align"] == "center" else x+item["w"]*72-width
                    pdf.drawString(xp, y-item["size"]*.85-i*item["size"]*item["leading"], value)
            elif k == "line":
                pdf.setStrokeColor(HexColor("#"+item["color"])); pdf.setLineWidth(item["weight"])
                pdf.line(x, y, item["x2"]*72, (H-item["y2"])*72)
            elif k == "image":
                pdf.drawImage(item["path"], x, y-item["h"]*72, item["w"]*72, item["h"]*72)
            else:
                pdf.setLineWidth(.8)
                if item["fill"]: pdf.setFillColor(HexColor("#"+item["fill"]))
                if item["stroke"]: pdf.setStrokeColor(HexColor("#"+item["stroke"]))
                kwargs = dict(fill=int(bool(item["fill"])), stroke=int(bool(item["stroke"])))
                if k == "circle":
                    pdf.ellipse(x, y-item["h"]*72, x+item["w"]*72, y, **kwargs)
                else:
                    pdf.roundRect(x, y-item["h"]*72, item["w"]*72, item["h"]*72, item["radius"]*72, **kwargs)
        pdf.showPage()
    pdf.save()
    return path


def write_notes():
    lines = ["# Artistree 발표 스크립트", "",
             "총 10장 · 약 6~8분(짧은 시연 포함) · 슬라이드 노트에도 같은 발표 멘트를 넣었습니다.", "",
             "PPT의 텍스트와 도형은 편집할 수 있습니다. 실제 화면 캡처는 정적 이미지이며, PPT 안에서 재생되지는 않습니다.", ""]
    for i, spec in enumerate(SLIDES, 1):
        lines += [f"## {i:02d}. {spec['title'].replace(chr(10), ' ') or 'Artistree 소개'}", "", spec["note"], ""]
    lines += ["## 선택 시연 순서 (약 40~60초)", "",
              "1. 아티스트 검색 → 결과 선택 → 인물 클릭으로 최대 네 명씩 펼치기.",
              "2. 가지 인물에 커서를 올려 곡과 참여자 그룹 강조 확인.",
              "3. 카드의 Open preview → 공식 플레이어의 재생 버튼 클릭.",
              "4. 창을 닫아 플레이어가 사라지고 탐색 화면으로 돌아오는 모습 보여주기.",
              "5. 시간이 남으면 경로와 Save 기능 소개. 외부 서비스가 느리면 캡처 화면으로 대체.", "",
              "## 예상 질문에 짧게 답하기", "",
              "- **모든 곡과 참여자가 나오나요?** 아니요. 현재 지도와 조회 범위에서 확인된 참여 정보만 보여줍니다.",
              "- **미리듣기는 전부 30초인가요?** 연결된 YouTube 영상은 앞부분 약 30초로 설정했습니다. 다른 공식 플레이어는 서비스·지역·로그인 상태에 따라 다릅니다.",
              "- **저장하면 다른 기기에서도 열리나요?** 현재는 같은 브라우저·같은 사이트 주소의 로컬 저장만 지원합니다.",
              "- **Spotify도 함께 섞이나요?** 아니요. Spotify 탐색은 별도 화면으로 분리했습니다.",
              "- **163개 테스트는 무엇인가요?** 기능 동작을 검사한 자동화 테스트 수입니다. 모든 음악 정보의 완전성이나 사용자 만족도를 뜻하지 않습니다.", "",
              "## 자료 근거", "",
              "- 현재 프로젝트의 README.md, 실제 구현 코드, 개발 중 사용자 요구와 수정 이력.",
              "- 실제 개발 화면 캡처: 검색·관계 지도, Obedient 참여자 그룹, 공식 플레이어 패널.",
              "- 개발 검증 기록: 자동화 테스트 163개 통과 및 실제 약 30초 재생·정지 확인.",
              "- 대외 공개 전 화면 속 아티스트 사진과 영상 제공처의 표시·배포 조건을 확인하세요.", ""]
    (ROOT / "발표_스크립트.md").write_text("\n".join(lines), encoding="utf-8")


def validate(pptx_path):
    prs = Presentation(pptx_path)
    assert len(prs.slides) == 10
    assert all(s.notes_slide.notes_text_frame.text.strip() for s in prs.slides)
    for i, slide in enumerate(prs.slides, 1):
        for sh in slide.shapes:
            if sh.left < 0 or sh.top < 0 or sh.left+sh.width > prs.slide_width+200 or sh.top+sh.height > prs.slide_height+200:
                WARNINGS.append(f"Slide {i}: off-slide shape {sh.name}")
    with ZipFile(pptx_path) as archive:
        assert archive.testzip() is None
        assert not any(name.startswith("ppt/media/") and name.endswith((".mp3", ".mp4", ".m4a")) for name in archive.namelist())
    (ROOT / "validation.json").write_text(json.dumps({
        "slides": len(prs.slides), "speaker_notes": 10, "format": "16:9",
        "text_boxes": sum(1 for slide in prs.slides for shape in slide.shapes if shape.has_text_frame and shape.text.strip()),
        "pictures": sum(1 for slide in prs.slides for shape in slide.shapes if shape.shape_type == 13),
        "editable_text_and_shapes": True, "audio_or_video_embedded": False,
        "warnings": WARNINGS
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    if WARNINGS:
        raise RuntimeError("\n".join(WARNINGS))


if __name__ == "__main__":
    pptx = render_pptx()
    pdf = render_pdf()
    write_notes()
    validate(pptx)
    print(f"Created {pptx.name}, {pdf.name}, 발표_스크립트.md — {len(SLIDES)} slides, no layout warnings.")
