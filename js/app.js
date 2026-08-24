import { Api, captureToken } from './api.js?v=20260824-2';
import { dailyTotals, numberOrNull, targetForDate } from './calculations.js';

const $ = id => document.getElementById(id);
const TIMES = ['06:30', '09:00', '18:30', '23:00'];
const FEED_SLOT_COUNT = 6;
const DRAFT_PREFIX = 'eundong-draft-';
const token = captureToken();

if (!token) $('unlinked').hidden = false;
else {
  $('app').hidden = false;
  start(new Api(token));
}

function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}
function displayDate(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  }).format(new Date(`${date}T12:00:00Z`));
}
function escape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function draftKey(date) { return `${DRAFT_PREFIX}${date}`; }

async function start(api) {
  let date = seoulDate();
  let day = blankDay();
  let settings = {};
  let history = [];
  let chart;
  let feedSlot = 1;
  let searchTimer;
  let dayRequest = 0;
  let historyDays = 30;
  const timers = new Map();
  const versions = new Map();

  $('dateLabel').textContent = displayDate(date);
  $('recordDate').value = date;
  $('recordDate').max = seoulDate();

  function blankDay() {
    return {
      weight: '',
      feeds: Array(FEED_SLOT_COUNT).fill(null),
      meals: TIMES.map((time, i) => ({
        meal_slot: i + 1,
        meal_time: time,
        feed_slot: null,
        amount_g: '',
        added_water_ml: '',
        moisture_snapshot: null,
        kcal_per_kg_snapshot: null,
      })),
    };
  }

  function status(text, error = false) {
    $('saveState').textContent = text;
    $('saveState').style.color = error ? 'var(--red)' : '';
  }
  function showError(message = '') {
    $('error').hidden = !message;
    $('error').textContent = message;
  }
  function saveDraft() {
    localStorage.setItem(draftKey(date), JSON.stringify({
      weight: day.weight,
      meals: day.meals.map(({ meal_slot, feed_slot, amount_g, added_water_ml }) => ({
        meal_slot, feed_slot, amount_g, added_water_ml,
      })),
    }));
  }
  function clearDraftIfSettled() {
    if (![...timers.values()].some(Boolean)) localStorage.removeItem(draftKey(date));
  }
  function debounce(key, action, payload, delay = 550) {
    const version = (versions.get(key) || 0) + 1;
    const requestPayload = payload();
    versions.set(key, version);
    clearTimeout(timers.get(key));
    saveDraft();
    status('저장 대기');
    timers.set(key, setTimeout(async () => {
      timers.set(key, null);
      status('저장 중');
      try {
        await api.call(action, requestPayload);
        if (versions.get(key) === version) {
          status('저장됨');
          $('syncedAt').textContent = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
          clearDraftIfSettled();
          await loadHistory(false);
        }
      } catch (e) {
        status('저장 실패', true);
        showError(e.status === 401
          ? '연결 주소가 올바르지 않습니다. 올바른 비밀 주소를 다시 열어 주세요.'
          : '저장하지 못했습니다. 입력값은 이 기기에 임시 보관했습니다. 네트워크를 확인해 주세요.');
      }
    }, delay));
  }
  function applyDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(date)));
      if (!d) return;
      if (d.weight !== undefined) day.weight = d.weight;
      for (const m of d.meals || []) {
        if (m.meal_slot >= 1 && m.meal_slot <= 4) Object.assign(day.meals[m.meal_slot - 1], m);
      }
      status('미저장 입력 복구');
    } catch {
      localStorage.removeItem(draftKey(date));
    }
  }

  async function loadDay(quiet = false) {
    const request = ++dayRequest;
    if (!quiet) status('불러오는 중');
    try {
      const body = await api.call('get_day', { date });
      if (request !== dayRequest) return;
      settings = body.settings || {};
      day = blankDay();
      day.weight = body.record?.weight_kg ?? '';
      for (const f of body.feeds || []) {
        if (f.feed_slot >= 1 && f.feed_slot <= FEED_SLOT_COUNT) day.feeds[f.feed_slot - 1] = f;
      }
      for (const m of body.meals || []) {
        if (m.meal_slot >= 1 && m.meal_slot <= 4) {
          day.meals[m.meal_slot - 1] = {
            ...day.meals[m.meal_slot - 1],
            ...m,
            amount_g: m.amount_g ?? '',
            added_water_ml: m.added_water_ml ?? '',
          };
        }
      }

      // 오늘 새 기록에만 직전 사료 프리셋을 복사한다. 과거 날짜를 열 때는 자동 생성하지 않는다.
      if (date === seoulDate() && !body.feeds?.length && body.previousFeeds?.length) {
        const latest = body.previousFeeds[0].recorded_date;
        const copies = body.previousFeeds.filter(f => f.recorded_date === latest).slice(0, FEED_SLOT_COUNT);
        if (copies.length) {
          await api.call('copy_feeds', { date, feeds: copies });
          return loadDay(quiet);
        }
      }

      applyDraft();
      render();
      status(date === seoulDate() ? '최신 기록' : '과거 기록');
      showError('');
      $('syncedAt').textContent = '방금';
    } catch (e) {
      status('불러오기 실패', true);
      showError(e.status === 401
        ? '비밀 연결 정보가 올바르지 않습니다.'
        : `Supabase 기록을 불러오지 못했습니다. ${e.message ? `(${e.message})` : ''}`);
    }
  }

  function render() {
    $('weight').value = day.weight;
    $('goalWeight').value = settings.goal_weight_kg ?? '';
    $('goalStartWeight').value = settings.goal_start_weight_kg ?? '';
    $('goalStartDate').value = settings.goal_start_date || '';
    $('goalEndDate').value = settings.goal_end_date || '';
    renderGoal();
    renderFeeds();
    renderMeals();
    renderTotals();
  }

  function renderGoal() {
    const weight = numberOrNull(day.weight);
    const goal = numberOrNull(settings.goal_weight_kg);
    const target = targetForDate(settings, date);
    $('remaining').textContent = weight != null && goal != null
      ? `목표까지 ${Math.abs(weight - goal).toFixed(2)} kg`
      : '목표를 설정해 주세요';
    $('weeklyGoal').textContent = target == null ? '목표선 —' : `이 날짜 목표 ${target.toFixed(2)} kg`;
  }

  function renderFeeds() {
    $('feedSlots').innerHTML = day.feeds.map((f, i) => `
      <button class="feed-slot ${f ? '' : 'empty'}" data-slot="${i + 1}">
        <span><span class="index">${String(i + 1).padStart(2, '0')}</span><span>
          <strong>${f ? escape(f.feed_name_snapshot) : '사료 검색'}</strong>
          ${f ? `<small>${f.moisture_snapshot == null ? '수분 정보 없음' : `수분 ${f.moisture_snapshot}%`} · ${f.kcal_per_kg_snapshot == null ? '칼로리 정보 없음' : `${Math.round(f.kcal_per_kg_snapshot)} kcal/kg`}</small>` : ''}
        </span></span>
        <span class="change">${f ? '변경' : '선택'}</span>
      </button>`).join('');
    document.querySelectorAll('.feed-slot').forEach(b => b.onclick = () => openSearch(Number(b.dataset.slot)));
  }

  function renderMeals() {
    $('meals').innerHTML = day.meals.map((m, i) => `
      <div class="meal">
        <div class="meal-main">
          <div class="meal-time"><b>0${i + 1}</b><strong>${TIMES[i]}</strong></div>
          <select data-i="${i}" data-key="feed_slot" aria-label="${i + 1}회 사료">
            <option value="">사료 선택</option>
            ${day.feeds.map((f, j) => f ? `<option value="${j + 1}" ${Number(m.feed_slot) === j + 1 ? 'selected' : ''}>${String(j + 1).padStart(2, '0')} ${escape(f.feed_name_snapshot)}</option>` : '').join('')}
          </select>
        </div>
        <label class="unit"><input data-i="${i}" data-key="amount_g" aria-label="${i + 1}회 급여량" type="number" min="0" max="5000" step="0.1" inputmode="decimal" value="${escape(m.amount_g)}"><span>g</span></label>
        <label class="unit"><input data-i="${i}" data-key="added_water_ml" aria-label="${i + 1}회 추가 물" type="number" min="0" max="5000" step="0.1" inputmode="decimal" value="${escape(m.added_water_ml)}"><span>ml</span></label>
      </div>`).join('');

    $('meals').querySelectorAll('input,select').forEach(el => el.oninput = () => {
      const i = Number(el.dataset.i);
      const value = el.dataset.key === 'feed_slot' ? (el.value ? Number(el.value) : null) : el.value;
      if (numberOrNull(value) != null && Number(value) < 0) { el.value = '0'; return; }
      day.meals[i][el.dataset.key] = value;
      const f = value && el.dataset.key === 'feed_slot'
        ? day.feeds[Number(value) - 1]
        : day.feeds[(day.meals[i].feed_slot || 0) - 1];
      Object.assign(day.meals[i], {
        moisture_snapshot: f?.moisture_snapshot ?? null,
        kcal_per_kg_snapshot: f?.kcal_per_kg_snapshot ?? null,
      });
      renderTotals();
      debounce(`meal-${date}-${i}`, 'upsert_meal', () => ({
        date,
        meal_slot: i + 1,
        feed_slot: day.meals[i].feed_slot,
        amount_g: Math.max(0, numberOrNull(day.meals[i].amount_g) ?? 0),
        added_water_ml: Math.max(0, numberOrNull(day.meals[i].added_water_ml) ?? 0),
      }));
    });
  }

  function renderTotals() {
    const t = dailyTotals(day.meals);
    const values = [
      ['사료', t.grams, 'g'], ['칼로리', t.kcal, 'kcal'], ['사료 수분', t.foodWater, 'ml'],
      ['추가 물', t.addedWater, 'ml'], ['총 수분', t.foodWater + t.addedWater, 'ml'],
    ];
    $('totals').innerHTML = values.map(([label, n, unit]) => `<div class="total"><span>${label}</span><strong>${Math.round(n * 10) / 10}<small>${unit}</small></strong></div>`).join('');
    $('missing').textContent = [
      t.missingKcal && '일부 사료의 칼로리 정보 없음 — 해당 급여는 칼로리 합계에서 제외',
      t.missingMoisture && '일부 사료의 수분 정보 없음 — 해당 급여는 사료 수분 합계에서 제외',
    ].filter(Boolean).join(' · ');
  }

  function openSearch(slot) {
    feedSlot = slot;
    $('dialogTitle').textContent = `사료 ${String(slot).padStart(2, '0')} 검색`;
    $('feedSearch').value = '';
    $('feedResults').innerHTML = '<p>제품명 두 글자 이상을 입력해 주세요.</p>';
    $('feedDialog').showModal();
    setTimeout(() => $('feedSearch').focus(), 50);
  }

  $('closeDialog').onclick = () => $('feedDialog').close();
  $('feedSearch').oninput = e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const rows = (await api.call('search_feeds', { query: e.target.value })).data || [];
        $('feedResults').innerHTML = rows.length ? rows.map((f, i) => {
          const kcal = f.final_me ?? f.official_me ?? f.corrected_me;
          return `<button class="result" data-i="${i}"><strong>${escape(f['제품명'])}</strong><small>${f.type === 'dry' ? '건식' : '습식'} · ${f['수분'] == null ? '수분 정보 없음' : `수분 ${f['수분']}%`} · ${kcal == null ? '칼로리 정보 없음' : `${Math.round(kcal)} kcal/kg`}</small></button>`;
        }).join('') : '<p>검색 결과가 없습니다.</p>';

        $('feedResults').querySelectorAll('button').forEach(b => b.onclick = async () => {
          const f = rows[Number(b.dataset.i)];
          const selectedDate = date;
          status('저장 중');
          try {
            await api.call('upsert_feed', { date: selectedDate, feed_slot: feedSlot, feed_id: f.id });
            $('feedDialog').close();
            if (date === selectedDate) await loadDay();
            const affected = day.meals.filter(m => Number(m.feed_slot) === feedSlot);
            await Promise.all(affected.map(m => api.call('upsert_meal', {
              date: selectedDate,
              meal_slot: m.meal_slot,
              feed_slot: m.feed_slot,
              amount_g: Number(m.amount_g || 0),
              added_water_ml: Number(m.added_water_ml || 0),
            })));
            if (affected.length && date === selectedDate) await loadDay(true);
            await loadHistory(false);
          } catch {
            status('저장 실패', true);
            showError('사료를 저장하지 못했습니다.');
          }
        });
      } catch {
        $('feedResults').innerHTML = '<p>사료 검색에 실패했습니다.</p>';
      }
    }, 300);
  };

  $('weight').oninput = e => {
    if (Number(e.target.value) < 0) e.target.value = '';
    day.weight = e.target.value;
    renderGoal();
    debounce(`weight-${date}`, 'upsert_weight', () => ({ date, weight_kg: numberOrNull(day.weight) }));
  };

  $('goalToggle').onclick = () => { $('goalFields').hidden = !$('goalFields').hidden; };
  for (const id of ['goalWeight', 'goalStartWeight', 'goalStartDate', 'goalEndDate']) {
    $(id).oninput = () => {
      settings.goal_weight_kg = $('goalWeight').value;
      settings.goal_start_weight_kg = $('goalStartWeight').value;
      settings.goal_start_date = $('goalStartDate').value;
      settings.goal_end_date = $('goalEndDate').value;
      renderGoal();
      if (settings.goal_start_date && settings.goal_end_date) {
        debounce('settings', 'update_settings', () => ({
          settings: {
            ...settings,
            goal_weight_kg: numberOrNull(settings.goal_weight_kg),
            goal_start_weight_kg: numberOrNull(settings.goal_start_weight_kg),
          },
        }));
      }
    };
  }

  $('recordDate').onchange = async e => {
    const next = e.target.value;
    const today = seoulDate();
    if (!next || next > today) {
      e.target.value = date;
      return;
    }
    date = next;
    $('dateLabel').textContent = displayDate(date);
    $('recordDate').value = date;
    await loadDay();
    await loadHistory();
  };

  async function loadHistory() {
    try {
      const body = await api.call('history', { days: historyDays });
      const waters = {};
      for (const m of body.meals || []) {
        const n = m.moisture_snapshot == null ? 0 : Number(m.amount_g) * Number(m.moisture_snapshot) / 100;
        waters[m.recorded_date] = (waters[m.recorded_date] || 0) + n + Number(m.added_water_ml || 0);
      }
      const map = new Map((body.records || []).map(r => [r.recorded_date, {
        date: r.recorded_date, weight: r.weight_kg, water: waters[r.recorded_date] || null,
      }]));
      for (const [d, water] of Object.entries(waters)) {
        if (!map.has(d)) map.set(d, { date: d, weight: null, water });
      }
      history = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
      drawChart();
    } catch { /* day data remains usable */ }
  }

  function drawChart() {
    const empty = !history.some(r => r.weight != null || r.water != null);
    $('chartEmpty').hidden = !empty;
    chart?.destroy();
    chart = null;
    if (empty || !window.Chart) return;
    chart = new Chart($('trend'), {
      data: {
        labels: history.map(r => r.date.slice(5).replace('-', '.')),
        datasets: [
          { type: 'line', label: '실제 체중', data: history.map(r => r.weight), yAxisID: 'y', borderColor: '#286657', backgroundColor: '#286657', tension: .2 },
          { type: 'line', label: '목표 체중', data: history.map(r => targetForDate(settings, r.date)), yAxisID: 'y', borderColor: '#9a6b1d', borderDash: [5, 4], pointRadius: 0 },
          { type: 'bar', label: '총 수분', data: history.map(r => r.water), yAxisID: 'water', backgroundColor: '#bfd5cb' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { position: 'left', ticks: { callback: v => `${v}kg` } },
          water: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => `${v}ml` } },
          x: { ticks: { maxTicksLimit: 7, maxRotation: 0 } },
        },
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } },
      },
    });
  }

  document.querySelectorAll('.ranges button').forEach(b => b.onclick = async () => {
    document.querySelectorAll('.ranges button').forEach(x => x.classList.toggle('active', x === b));
    historyDays = b.dataset.days === 'all' ? null : Number(b.dataset.days);
    await loadHistory();
  });

  window.addEventListener('focus', () => {
    const today = seoulDate();
    $('recordDate').max = today;
    if (date === today && ![...timers.values()].some(Boolean)) loadDay(true).then(() => loadHistory());
  });

  setInterval(() => {
    const today = seoulDate();
    $('recordDate').max = today;
    if (date === today && $('recordDate').value !== today) $('recordDate').value = today;
  }, 60000);

  await loadDay();
  await loadHistory();
}
