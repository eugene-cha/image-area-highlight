/**
 * 클릭 지점의 사각형 테두리 박스를 이미지에서 찾아주는 모듈.
 *
 * detectBoxAt(imageData, x, y) -> { x, y, w, h } | null
 *
 * 알고리즘
 *  1. 시드 지점에서 위/아래/왼/오른쪽으로 훑으며, 시드를 지나는 "색 경계선"(엣지가 이어진
 *     가로/세로 선분)을 후보로 수집한다.
 *  2. 상/하/좌/우 후보 중 네 선분이 닫힌 사각형을 이루고, 네 변을 따라 실제로 엣지가 충분히
 *     이어져 있는 것을 찾아 그 중 면적이 가장 작은(= 시드에 가장 가까운) 사각형을 선택한다.
 *  3. 테두리가 두꺼우면 바깥쪽 끝까지 확장해서 테두리 전체를 포함시킨다.
 *  4. 클릭 지점이 테두리 선 위인 경우에는 선 밖으로 벗어난 지점들을 시드로 삼아 1~3을 반복하고,
 *     클릭 지점이 테두리 위에 있는 사각형 중 가장 작은 것을 고른다.
 *  5. 먼저 엄격한 기준(JPEG 노이즈/글자 줄이 만드는 가짜 사각형 배제)으로 찾고, 못 찾으면
 *     관대한 기준(아주 연한 테두리, 점선)으로 다시 찾는다.
 */
(function (global) {
  // 탐색 기준. strict 로 먼저 시도하고 실패하면 lenient 로 재시도한다.
  const PROFILES = [
    { edge: 24, gap: 2, coverage: 0.8, minSize: 24 },  // strict: 노이즈에 강함
    { edge: 12, gap: 5, coverage: 0.5, minSize: 40 }   // lenient: 연한 테두리, 점선 대응 (가짜 사각형이 생기기 쉬워 최소 크기를 키움)
  ];

  const SEED_SEARCH = 2;       // 시드 지점에서 선분을 찾을 때 허용하는 오차(px)
  const MIN_RUN = 16;          // 선분으로 인정하는 최소 길이(px)
  const STRUCT_TOL = 24;       // 후보 선분끼리 모서리가 만나는지 볼 때의 허용 오차(px). 최종 판정은 변 연속성 검사가 한다.
  const CORNER_TOL = 10;       // 변 연속성 검사에서 제외하는 모서리 구간(px) - 둥근 모서리 대응
  const MAX_CANDIDATES = 400;  // 방향별 후보 선분 최대 개수
  const SEARCH_BUDGET = 3e6;   // 사각형 조합 탐색 상한(노이즈가 심한 이미지 보호)
  const MAX_BORDER = 12;       // 테두리 두께 상한(px). 이보다 두꺼우면 배경으로 보고 확장 안 함
  const BORDER_MATCH_RATIO = 0.6;
  const CONTAIN_SLACK = 3;     // 클릭 지점이 결과 박스에 포함되는지 볼 때의 여유(px)
  const LINE_SEED_DISTANCES = [2, 12, 30, 60]; // 테두리 위 클릭 시, 선에서 벗어난 뒤 안쪽/바깥쪽으로 더 나아가 시드를 두는 거리(px)
  const RING_SEED_RADII = [12, 30, 60];        // 클릭 지점에서 박스를 못 찾았을 때 주변에 시드를 두는 반경(px)

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function detectBoxAt(img, px, py) {
    const data = img.data;
    const W = img.width;
    const H = img.height;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;

    // 현재 탐색 기준 (runProfile 에서 설정)
    let edgeT = PROFILES[0].edge;
    let gapTol = PROFILES[0].gap;
    let minCov = PROFILES[0].coverage;
    let minSize = PROFILES[0].minSize; // 사각형 최소 너비/높이(px) - 글자 하나를 감싸는 작은 사각형 배제

    function diff(i, j) {
      const dr = Math.abs(data[i] - data[j]);
      const dg = Math.abs(data[i + 1] - data[j + 1]);
      const db = Math.abs(data[i + 2] - data[j + 2]);
      return dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    }

    // y 행 경계(y-1 | y)에서 x 위치의 가로 엣지 여부
    function hEdge(x, y) {
      return diff(((y - 1) * W + x) * 4, (y * W + x) * 4) > edgeT;
    }
    // x 열 경계(x-1 | x)에서 y 위치의 세로 엣지 여부
    function vEdge(x, y) {
      return diff((y * W + x - 1) * 4, (y * W + x) * 4) > edgeT;
    }

    // center 주변에서 엣지인 위치를 찾아 양쪽으로 이어진 구간 [lo, hi]를 반환
    function findRun(isEdge, center, size) {
      let seed = -1;
      for (let d = 0; d <= SEED_SEARCH && seed < 0; d++) {
        if (center - d >= 0 && isEdge(center - d)) seed = center - d;
        else if (center + d < size && isEdge(center + d)) seed = center + d;
      }
      if (seed < 0) return null;

      let lo = seed;
      for (let i = seed - 1, gap = 0; i >= 0; i--) {
        if (isEdge(i)) { lo = i; gap = 0; }
        else if (++gap > gapTol) break;
      }
      let hi = seed;
      for (let i = seed + 1, gap = 0; i < size; i++) {
        if (isEdge(i)) { hi = i; gap = 0; }
        else if (++gap > gapTol) break;
      }
      return hi - lo + 1 >= MIN_RUN ? { lo, hi } : null;
    }

    // from → to 방향(step)으로 pos 를 옮기며 후보 선분 수집 (시드에 가까운 순)
    function collect(from, to, step, runAt) {
      const list = [];
      for (let pos = from; pos !== to + step && list.length < MAX_CANDIDATES; pos += step) {
        const run = runAt(pos);
        if (!run) continue;
        const last = list[list.length - 1];
        // 안티앨리어싱으로 인접한 두 줄이 모두 엣지인 경우 가까운 쪽만 사용
        if (last && Math.abs(last.pos - pos) === 1) continue;
        list.push({ pos, lo: run.lo, hi: run.hi });
      }
      return list;
    }

    // 네 변 각각에서 실제로 엣지가 이어져 있는 비율을 확인한다.
    // 글자 주변이나 압축 노이즈로 짧은 선분들이 우연히 사각형처럼 조합된 경우를 걸러낸다.
    function hasContinuousSides(l, t, r, b) {
      const eh = (x, y) => y >= 1 && y < H && hEdge(x, y);
      const ev = (x, y) => x >= 1 && x < W && vEdge(x, y);
      const trimX = r - l > CORNER_TOL * 4;
      const trimY = b - t > CORNER_TOL * 4;
      const x0 = trimX ? l + CORNER_TOL : l;
      const x1 = trimX ? r - CORNER_TOL : r;
      const y0 = trimY ? t + CORNER_TOL : t;
      const y1 = trimY ? b - CORNER_TOL : b;
      let top = 0, bottom = 0, left = 0, right = 0;
      for (let x = x0; x < x1; x++) {
        if (eh(x, t) || eh(x, t - 1) || eh(x, t + 1)) top++;
        if (eh(x, b) || eh(x, b - 1) || eh(x, b + 1)) bottom++;
      }
      for (let y = y0; y < y1; y++) {
        if (ev(l, y) || ev(l - 1, y) || ev(l + 1, y)) left++;
        if (ev(r, y) || ev(r - 1, y) || ev(r + 1, y)) right++;
      }
      const wLen = Math.max(x1 - x0, 1);
      const hLen = Math.max(y1 - y0, 1);
      return Math.min(top / wLen, bottom / wLen, left / hLen, right / hLen) >= minCov;
    }

    // 시드 (sx, sy)를 감싸는 가장 작은 사각형(테두리 확장 전). 없으면 null
    function findRect(sx, sy) {
      const hRun = y => findRun(x => hEdge(x, y), sx, W);
      const vRun = x => findRun(y => vEdge(x, y), sy, H);

      const tops = sy >= 1 ? collect(sy, 1, -1, hRun) : [];
      const bottoms = sy + 1 <= H - 1 ? collect(sy + 1, H - 1, 1, hRun) : [];
      const lefts = sx >= 1 ? collect(sx, 1, -1, vRun) : [];
      const rights = sx + 1 <= W - 1 ? collect(sx + 1, W - 1, 1, vRun) : [];
      if (!tops.length || !bottoms.length || !lefts.length || !rights.length) return null;

      // 후보들은 시드에서 멀어지는 순서라 거리가 단조 증가한다.
      // 따라서 이미 찾은 사각형보다 면적이 커지는 순간 안쪽 루프를 끊을 수 있다.
      const minWidth = Math.max(rights[0].pos - lefts[0].pos, minSize);
      let best = null;
      let ops = 0;

      for (const t of tops) {
        if (best && (bottoms[0].pos - t.pos) * minWidth >= best.area) break;
        for (const b of bottoms) {
          const height = b.pos - t.pos;
          if (best && height * minWidth >= best.area) break;
          if (height < minSize) continue;
          for (const l of lefts) {
            if (best && height * (rights[0].pos - l.pos) >= best.area) break;
            if (l.lo > t.pos + STRUCT_TOL || l.hi < b.pos - STRUCT_TOL) continue;
            if (t.lo > l.pos + STRUCT_TOL || b.lo > l.pos + STRUCT_TOL) continue;
            for (const r of rights) {
              if (++ops > SEARCH_BUDGET) return best;
              const width = r.pos - l.pos;
              const area = width * height;
              if (best && area >= best.area) break;
              if (width < minSize) continue;
              if (t.hi < r.pos - STRUCT_TOL || b.hi < r.pos - STRUCT_TOL) continue;
              if (r.lo > t.pos + STRUCT_TOL || r.hi < b.pos - STRUCT_TOL) continue;
              ops += 50;
              if (!hasContinuousSides(l.pos, t.pos, r.pos, b.pos)) continue;
              best = { l: l.pos, t: t.pos, r: r.pos, b: b.pos, area };
            }
          }
        }
      }
      return best;
    }

    // ---- 테두리 두께만큼 바깥쪽으로 확장 ----
    // idxAt(k, s): 변에서 k번째 줄(k=0: 안쪽 첫 줄, k=1: 바깥 첫 줄, k<0: 더 안쪽)의
    //              변을 따라 s번째 샘플 픽셀의 data 인덱스
    // limit: 바깥쪽으로 이동 가능한 최대 거리(이미지 경계)
    function borderThickness(count, limit, idxAt) {
      const maxK = Math.min(MAX_BORDER, limit);
      if (maxK < 1 || count < 1) return 0;

      // k번째 줄에서 가장 많이 나온 색(16단계로 양자화해 센다)의 대표 픽셀 인덱스
      function modeIdx(k) {
        const bins = new Map();
        let rep = 0;
        let repCount = 0;
        for (let s = 0; s < count; s++) {
          const i = idxAt(k, s);
          const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
          const n = (bins.get(key) || 0) + 1;
          bins.set(key, n);
          if (n > repCount) { repCount = n; rep = i; }
        }
        return rep;
      }
      function dist(i, j) {
        return Math.max(Math.abs(data[i] - data[j]), Math.abs(data[i + 1] - data[j + 1]), Math.abs(data[i + 2] - data[j + 2]));
      }

      // 안쪽 색은 경계 바로 옆(번짐이 있을 수 있음)이 아니라 몇 px 안쪽에서 잡는다.
      const inside = modeIdx(-4);
      // 바깥 1~3번째 줄 중 안쪽 색과 대비가 가장 큰 색을 테두리 색으로 본다.
      let ref = modeIdx(1);
      for (let k = 2; k <= Math.min(3, maxK); k++) {
        const cand = modeIdx(k);
        if (dist(cand, inside) > dist(ref, inside)) ref = cand;
      }
      const rr = data[ref], rg = data[ref + 1], rb = data[ref + 2];
      const ir = data[inside], ig = data[inside + 1], ib = data[inside + 2];

      // 바깥쪽 줄의 픽셀이 "안쪽 색"보다 "테두리 색"에 더 가까우면 테두리로 본다.
      // (JPEG 색 번짐으로 테두리 색이 조금 변해도 따라가도록 절대 오차가 아닌 상대 비교를 쓴다.)
      const contrast = Math.max(Math.abs(rr - ir), Math.abs(rg - ig), Math.abs(rb - ib));
      const maxDist = contrast * 0.75;

      // 바깥쪽 k번째 줄에서 테두리 색으로 보이는 픽셀의 비율
      function matchRatio(row) {
        let match = 0;
        for (let s = 0; s < count; s++) {
          const i = idxAt(row, s);
          const dRef = Math.max(Math.abs(data[i] - rr), Math.abs(data[i + 1] - rg), Math.abs(data[i + 2] - rb));
          const dIn = Math.max(Math.abs(data[i] - ir), Math.abs(data[i + 1] - ig), Math.abs(data[i + 2] - ib));
          if (dRef <= maxDist && dRef < dIn) match++;
        }
        return match / count;
      }

      let k = 0;
      while (k < maxK) {
        if (matchRatio(k + 1) >= BORDER_MATCH_RATIO) { k++; continue; }
        // 경계 바로 바깥 한 줄이 JPEG 번짐으로 테두리 색과 안쪽 색이 섞여 있을 수 있으므로,
        // 첫 줄에 한해 그 다음 줄이 테두리 색이면 한 줄을 건너뛰고 계속한다.
        if (k === 0 && maxK >= 2 && matchRatio(2) >= BORDER_MATCH_RATIO) { k = 2; continue; }
        break;
      }
      // 상한까지 계속 같은 색이면 테두리가 아니라 넓은 배경이므로 확장하지 않는다.
      if (k >= MAX_BORDER && limit > MAX_BORDER) return 0;
      return k;
    }

    // 변을 따라 최대 200개만 샘플링
    function samples(length) {
      return Math.min(length, 200);
    }
    function at(start, length, s, n) {
      return start + Math.floor((s + 0.5) * length / n);
    }

    function expand(raw) {
      const { l, t, r, b } = raw;
      const w = r - l;
      const h = b - t;
      const nx = samples(w);
      const ny = samples(h);

      const extTop = borderThickness(nx, t, (k, s) => ((t - k) * W + at(l, w, s, nx)) * 4);
      const extBottom = borderThickness(nx, H - b, (k, s) => ((b + k - 1) * W + at(l, w, s, nx)) * 4);
      const extLeft = borderThickness(ny, l, (k, s) => (at(t, h, s, ny) * W + (l - k)) * 4);
      const extRight = borderThickness(ny, W - r, (k, s) => (at(t, h, s, ny) * W + (r + k - 1)) * 4);

      return {
        x: l - extLeft,
        y: t - extTop,
        w: w + extLeft + extRight,
        h: h + extTop + extBottom
      };
    }

    // 시드들로 찾은 박스 중 클릭 지점을 포함하는 가장 작은 박스.
    // requireBand: 클릭 지점이 박스의 테두리 두께 안(=테두리 위)에 있어야 한다.
    function pickBox(seedList, requireBand) {
      let result = null;
      let resultArea = Infinity;
      for (const [sx, sy] of seedList) {
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const raw = findRect(sx, sy);
        if (!raw) continue;
        const box = expand(raw);
        if (cx < box.x - CONTAIN_SLACK || cx >= box.x + box.w + CONTAIN_SLACK) continue;
        if (cy < box.y - CONTAIN_SLACK || cy >= box.y + box.h + CONTAIN_SLACK) continue;
        if (requireBand) {
          const dist = Math.min(cx - box.x, box.x + box.w - 1 - cx, cy - box.y, box.y + box.h - 1 - cy);
          if (dist > MAX_BORDER) continue;
        }
        const area = box.w * box.h;
        if (area < resultArea) { result = box; resultArea = area; }
      }
      return result;
    }

    // 클릭 픽셀과 다른 색이 나올 때까지의 걸음 수. MAX_BORDER 안에 못 벗어나면 -1
    function escapeSteps(dx, dy) {
      const base = (cy * W + cx) * 4;
      for (let k = 1; k <= MAX_BORDER; k++) {
        const x = cx + dx * k;
        const y = cy + dy * k;
        if (x < 0 || y < 0 || x >= W || y >= H) return -1;
        if (diff(base, (y * W + x) * 4) > edgeT) return k;
      }
      return -1;
    }

    function runProfile(profile) {
      edgeT = profile.edge;
      gapTol = profile.gap;
      minCov = profile.coverage;
      minSize = profile.minSize;

      // 클릭 지점이 얇은 선(테두리) 위인지 판단
      const esc = DIRS.map(d => escapeSteps(d[0], d[1]));
      const [eR, eL, eD, eU] = esc;
      const onLine =
        (eR > 0 && eL > 0) || (eD > 0 && eU > 0) ||          // 가로/세로 선 위
        ((eR > 0 || eL > 0) && (eD > 0 || eU > 0));           // 모서리/교차점

      let result = null;

      // (1) 테두리 위를 클릭했다면: 선 밖으로 벗어난 지점들을 시드로 삼는다.
      //     모서리가 둥근 박스에서 시드가 모서리에 너무 붙지 않도록 여러 거리에 시드를 둔다.
      if (onLine) {
        const seeds = [];
        DIRS.forEach((d, i) => {
          if (esc[i] < 0) return;
          for (const extra of LINE_SEED_DISTANCES) {
            seeds.push([cx + d[0] * (esc[i] + extra), cy + d[1] * (esc[i] + extra)]);
          }
        });
        result = pickBox(seeds, true);
      }

      // (2) 클릭 지점 자체를 시드로 (박스 안쪽 클릭)
      if (!result) result = pickBox([[cx, cy]], false);

      // (3) 그래도 없으면 주변 시드로 재시도 (둥근 모서리 바로 옆을 클릭한 경우 등)
      if (!result) {
        const ring = [];
        for (const radius of RING_SEED_RADII) {
          for (const d of DIRS) ring.push([cx + d[0] * radius, cy + d[1] * radius]);
        }
        result = pickBox(ring, false);
      }
      return result;
    }

    for (const profile of PROFILES) {
      const result = runProfile(profile);
      if (result) return result;
    }
    return null;
  }

  const api = { detectBoxAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AutoDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);
