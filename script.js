// 1. Supabase 설정 (Anon Key는 유지)
const SUPABASE_URL = 'https://qpklvtgnhrdmzxzlstpp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwa2x2dGduaHJkbXp4emxzdHBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjE1MjIsImV4cCI6MjA5MTUzNzUyMn0.6nI4uEp9H9gVn3Sjm4Qhs5XXFvhUhfGBf6e0Nqce1EM';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 선택된 사료 정보를 담을 전역 객체
let selectedFeeds = {
    dry: [null, null],
    wet: [null, null, null]
};

// [함수] 메인 비율 업데이트 (슬라이더)
function updateMainRatio(v) {
    document.getElementById('dryTotalText').innerText = 100 - v;
    document.getElementById('wetTotalText').innerText = v;
}

// [함수] 건사료 교체 모드 토글
function toggleDrySwitching() {
    const checkbox = document.getElementById('drySwitching');
    const area2 = document.getElementById('dryArea2');
    const pct1 = document.getElementById('dryPct1');
    const pct2 = document.getElementById('dryPct2');

    if (checkbox.checked) {
        area2.classList.remove('hidden');
        pct1.value = 70;
        pct2.value = 30;
    } else {
        area2.classList.add('hidden');
        pct1.value = 100;
        pct2.value = 0;
        document.getElementById('dryInput2').value = '';
        selectedFeeds.dry[1] = null;
    }
}

// [함수] 사료 검색 (Supabase)
async function searchFeed(type, query, resId) {
    if (query.length < 2) {
        document.getElementById(resId).innerHTML = '';
        return;
    }

    const { data, error } = await _supabase
        .from('feeds')
        .select('제조사, 제품명, final_me')
        .eq('type', type)
        .eq('verified', true)
        .or(`제품명.ilike.%${query}%,제조사.ilike.%${query}%`)
        .limit(5);

    if (error) return;

    const container = document.getElementById(resId);
    container.innerHTML = data.map(f => `
        <div onclick="selectFeed('${type}', '${resId}', '${f.제조사}', '${f.제품명}', ${f.final_me})" 
             class="p-4 border-b border-gray-50 hover:bg-gray-50 cursor-pointer text-sm text-gray-800">
            <b class="text-[#2d7dd2]">${f.제조사}</b> | ${f.제품명}
        </div>
    `).join('');
}

// [함수] 사료 선택
function selectFeed(type, resId, brand, name, kcal) {
    const idx = parseInt(resId.match(/\d+/)[0]) - 1;
    const inputId = type === 'dry' ? `dryInput${idx + 1}` : `wetInput${idx + 1}`;
    document.getElementById(inputId).value = `${brand} | ${name}`;
    document.getElementById(resId).innerHTML = '';
    selectedFeeds[type][idx] = { name, kcal };
}

// [함수] 최종 계산
function calculate() {
    const weight = parseFloat(document.getElementById('catWeight').value);
    const birthStr = document.getElementById('catBirth').value;
    if (!weight || !birthStr) { alert("정보를 모두 입력해주세요!"); return; }

    const ageMonths = (new Date() - new Date(birthStr)) / (1000 * 60 * 60 * 24 * 30.4);
    const RER = 70 * Math.pow(weight, 0.75);
    let factor = 1.2;

    if (ageMonths < 4) factor = 2.75;
    else if (ageMonths < 9) factor = 2.1;
    else if (ageMonths < 12) factor = 1.9;
    else if (ageMonths >= 132) factor = 1.1;
    else factor = document.getElementById('catNeutered').value === 'true' ? 1.2 : 1.4;

    if (document.getElementById('isDiet').checked) factor *= 0.9;
    const DER = RER * factor;

    const dryTotalRatio = parseInt(document.getElementById('dryTotalText').innerText) / 100;
    const wetTotalRatio = parseInt(document.getElementById('wetTotalText').innerText) / 100;
    
    let detailsHtml = "";
    selectedFeeds.dry.forEach((f, i) => {
        if (f) {
            const subRatio = parseInt(document.getElementById(`dryPct${i+1}`).value) / 100;
            const grams = (DER * dryTotalRatio * subRatio / f.kcal) * 1000;
            detailsHtml += `<div class="flex justify-between bg-gray-800 p-5 rounded-2xl mb-2"><span class="text-orange-400 font-bold">${f.name}</span><span class="font-black text-white">${Math.round(grams)}g</span></div>`;
        }
    });
    selectedFeeds.wet.forEach((f, i) => {
        if (f) {
            const subRatio = parseInt(document.getElementById(`wetPct${i+1}`).value) / 100;
            const grams = (DER * wetTotalRatio * subRatio / f.kcal) * 1000;
            detailsHtml += `<div class="flex justify-between bg-gray-800 p-5 rounded-2xl mb-2"><span class="text-blue-400 font-bold">${f.name}</span><span class="font-black text-white">${Math.round(grams)}g</span></div>`;
        }
    });

    document.getElementById('resDER').innerHTML = `${Math.round(DER)} <span class="text-lg">kcal</span>`;
    document.getElementById('resDetails').innerHTML = detailsHtml || "<p class='text-center text-gray-500'>사료를 선택해 주세요.</p>";
    document.getElementById('resultArea').classList.remove('hidden');
    document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth' });
}
