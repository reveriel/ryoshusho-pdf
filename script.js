/* =========================================================
   領収書 作成ツール — script.js
   純粋なフロントエンドのみ。外部通信は行いません。
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     ユーティリティ
     --------------------------------------------------------- */

  // 全角英数字・記号を半角に正規化
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, ' ');
  }

  // 通貨文字列 → 数値
  function parseMoney(str) {
    if (str === null || str === undefined) return 0;
    var cleaned = toHalfWidth(String(str)).replace(/[^\d.-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // 0以上の整数円にまるめる
  function toAmount(str) {
    var n = Math.round(parseMoney(str));
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // 数値 → 千分位カンマ
  function comma(n) {
    var rounded = Math.round(n);
    var neg = rounded < 0;
    var s = String(Math.abs(rounded));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // 数値 → ¥1,234
  function yen(n) {
    return '¥' + comma(n);
  }

  // "2026-10-11" → "2026年10月11日"
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  var KANJI_DIGITS = ['零', '壱', '弐', '参', '肆', '伍', '陸', '漆', '捌', '玖'];
  var KANJI_SMALL = ['', '拾', '百', '千'];
  var KANJI_BIG = ['', '萬', '億', '兆'];

  // 整数 → 大字（漢数字）表記。例: 330000 → "参拾参萬"
  function kanjiNumber(n) {
    var num = Math.floor(Math.abs(Number(n) || 0));
    if (num === 0) return '零';

    var out = '';
    var groupIndex = 0;

    while (num > 0) {
      var group = num % 10000;
      if (group > 0) {
        var groupStr = '';
        var g = group;
        var unitIndex = 0;
        while (g > 0) {
          var digit = g % 10;
          if (digit > 0) groupStr = KANJI_DIGITS[digit] + KANJI_SMALL[unitIndex] + groupStr;
          g = Math.floor(g / 10);
          unitIndex += 1;
        }
        out = groupStr + KANJI_BIG[groupIndex] + out;
      }
      num = Math.floor(num / 10000);
      groupIndex += 1;
    }

    return out;
  }

  // 税込金額 → 内消費税額（1円未満切り捨て）
  function includedTax(amount, rate) {
    return Math.floor(amount * rate / (100 + rate));
  }

  function $(id) { return document.getElementById(id); }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function placeholder(text) {
    return '<span class="ph">' + text + '</span>';
  }

  /* ---------------------------------------------------------
     状態
     --------------------------------------------------------- */

  // 紙の領収書は記載金額 5万円以上で印紙税の課税文書（第17号文書）になる
  var STAMP_THRESHOLD = 50000;

  var DEFAULTS = {
    clientName: '株式会社サンプル',
    clientHonorific: '様',
    receiptNo: 'R-2026-001',
    proviso: 'WEBサイト制作費として',
    amountMode: 'single',
    amountTotal: 330000,
    amount10: 300000,
    amount8: 30000,
    showTax: true,
    taxRateIncluded: '10',
    useDaiji: true,
    issuerName: '山田 太郎',
    issuerAddress: '〒150-0001 東京都渋谷区神宮前1-2-3 サンプルビル5F',
    issuerTel: '03-1234-5678',
    regNumber: 'T1234567890123',
    notes: '本書は領収書として発行するものです。\n再発行はいたしかねますので、大切に保管してください。'
  };

  /* ---------------------------------------------------------
     登録番号の検証
     --------------------------------------------------------- */

  function normalizeRegNumber(value) {
    return toHalfWidth(value).replace(/[\s　-]/g, '').toUpperCase();
  }

  // 空なら null、正しければ正規化文字列、誤りなら false
  function validateRegNumber(value) {
    var normalized = normalizeRegNumber(value);
    if (normalized === '') return null;
    return /^T\d{13}$/.test(normalized) ? normalized : false;
  }

  /* ---------------------------------------------------------
     金額の取り出し
     --------------------------------------------------------- */

  function getAmounts() {
    var mode = $('amountMode').value;

    if (mode === 'split') {
      var a10 = toAmount($('amount10').value);
      var a8 = toAmount($('amount8').value);
      return {
        mode: 'split',
        amount10: a10,
        amount8: a8,
        total: a10 + a8,
        tax: includedTax(a10, 10) + includedTax(a8, 8)
      };
    }

    var total = toAmount($('amountTotal').value);
    var rate = $('taxRateIncluded').value === '8' ? 8 : 10;
    return {
      mode: 'single',
      amount10: 0,
      amount8: 0,
      total: total,
      rate: rate,
      tax: includedTax(total, rate)
    };
  }

  /* ---------------------------------------------------------
     プレビューの描画
     --------------------------------------------------------- */

  function renderPreview() {
    var amounts = getAmounts();
    var useDaiji = $('useDaiji').checked;
    var showTax = $('showTax').checked;

    /* --- 金額 --- */
    var amountEl = $('pvAmount');
    if (useDaiji) {
      amountEl.className = 'amount-value daiji';
      amountEl.textContent = '金 ' + kanjiNumber(amounts.total) + '円 也';
    } else {
      amountEl.className = 'amount-value num';
      amountEl.textContent = yen(amounts.total) + '-';
    }

    /* --- 宛名 --- */
    var honorific = $('clientHonorific').value;
    var clientName = $('clientName').value.trim();
    var isAtesama = honorific === '上様';

    // 宛名が「上様」のときは宛名欄を使わない
    $('clientName').disabled = isAtesama;

    if (isAtesama) {
      $('pvClientName').textContent = '';
      $('pvHonorific').textContent = '上様';
    } else {
      $('pvClientName').innerHTML = clientName
        ? escapeHtml(clientName)
        : placeholder('宛名を入力');
      $('pvHonorific').textContent = honorific;
    }

    /* --- 発行日・番号 --- */
    var dateISO = $('issueDate').value;
    $('pvDate').innerHTML = dateISO ? escapeHtml(formatDate(dateISO)) : placeholder('未入力');

    var receiptNo = $('receiptNo').value.trim();
    $('pvNoLine').hidden = !receiptNo;
    $('pvNo').textContent = receiptNo;

    /* --- 但書 --- */
    var proviso = $('proviso').value.trim();
    $('pvProviso').innerHTML = proviso ? escapeHtml(proviso) : placeholder('但書を入力');

    /* --- 消費税の内訳 --- */
    var taxRows = $('pvTaxRows');
    var taxBlock = $('pvTaxBlock');
    taxRows.innerHTML = '';
    var hasTaxRows = false;

    if (amounts.mode === 'split') {
      // 適格簡易請求書にあわせて税率ごとの合計額を区分表示する
      var groups = [
        { rate: 10, label: '10% 対象（標準税率・税込）', value: amounts.amount10 },
        { rate: 8, label: '8% 対象（軽減税率・税込）', value: amounts.amount8 }
      ];
      groups.forEach(function (g) {
        if (g.value <= 0) return;
        hasTaxRows = true;
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + g.label + '</td><td class="num">' + yen(g.value) + '</td>';
        taxRows.appendChild(tr);
      });
      if (showTax && amounts.total > 0) {
        hasTaxRows = true;
        var trTax = document.createElement('tr');
        trTax.className = 'breakdown-sub';
        trTax.innerHTML = '<td>（うち消費税額）</td><td class="num">' + yen(amounts.tax) + '</td>';
        taxRows.appendChild(trTax);
      }
    } else if (showTax && amounts.total > 0) {
      hasTaxRows = true;
      var trIncluded = document.createElement('tr');
      trIncluded.className = 'breakdown-sub';
      trIncluded.innerHTML =
        '<td>（うち消費税額 ' + amounts.rate + '%）</td>' +
        '<td class="num">' + yen(amounts.tax) + '</td>';
      taxRows.appendChild(trIncluded);
    }

    taxBlock.hidden = !hasTaxRows;

    /* --- 収入印紙の注意喚起（画面のみ） --- */
    var needsStamp = amounts.total >= STAMP_THRESHOLD;
    $('stampAlert').hidden = !needsStamp;
    $('stampBadge').hidden = !needsStamp;
    if (needsStamp) $('stampAmount').textContent = yen(amounts.total);

    /* --- 発行元 --- */
    var issuerName = $('issuerName').value.trim();
    $('pvIssuerName').innerHTML = issuerName
      ? escapeHtml(issuerName)
      : placeholder('屋号・氏名を入力');

    var address = $('issuerAddress').value.trim();
    $('pvIssuerAddressLine').hidden = !address;
    $('pvIssuerAddress').textContent = address;

    var tel = $('issuerTel').value.trim();
    $('pvIssuerTelLine').hidden = !tel;
    $('pvIssuerTel').textContent = tel;

    var regResult = validateRegNumber($('regNumber').value);
    var regLine = $('pvRegLine');
    var regOut = $('pvRegNumber');
    if (regResult === false) {
      regLine.hidden = false;
      regOut.innerHTML = '<span class="reg-bad">' +
        escapeHtml(toHalfWidth($('regNumber').value).trim() || '（未入力）') + '</span>';
    } else if (regResult === null) {
      regLine.hidden = true;
      regOut.textContent = '';
    } else {
      regLine.hidden = false;
      regOut.textContent = regResult;
    }

    /* --- 備考 --- */
    var notes = $('notes').value.trim();
    $('pvNotesBlock').hidden = !notes;
    $('pvNotes').textContent = notes;

    /* --- 注記 --- */
    var paperNote = $('pvPaperNote');
    var noteText = '';
    if (amounts.mode === 'single' && showTax && amounts.total > 0) {
      noteText = '※ 消費税額は税込金額から逆算し、1円未満は切り捨てています。';
    }
    if (regResult === false) {
      noteText += (noteText ? ' ' : '') +
        '※ 登録番号の形式が正しくないため、この番号はそのまま使用しないでください。';
    }
    paperNote.hidden = !noteText;
    paperNote.textContent = noteText;
  }

  /* ---------------------------------------------------------
     入力モードの切り替え
     --------------------------------------------------------- */

  function updateModeVisibility() {
    var mode = $('amountMode').value;
    var isSplit = mode === 'split';

    $('singleAmountBlock').hidden = isSplit;
    $('splitAmountBlock').hidden = !isSplit;
    // 税率区分で入力する場合、内消費税額の税率は区分ごとに決まる
    $('taxRateBlock').hidden = isSplit || !$('showTax').checked;
  }

  /* ---------------------------------------------------------
     登録番号エラー表示
     --------------------------------------------------------- */

  function updateRegNumberState() {
    var input = $('regNumber');
    var errorEl = $('regNumberError');

    if (validateRegNumber(input.value) === false) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      errorEl.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     イベント
     --------------------------------------------------------- */

  // 金額欄からフォーカスが外れたらカンマ区切りに整形
  function formatAmountField(input) {
    var value = toAmount(input.value);
    input.value = value ? comma(value) : '';
  }

  function applyFieldDefaults() {
    $('clientName').value = DEFAULTS.clientName;
    $('clientHonorific').value = DEFAULTS.clientHonorific;
    $('receiptNo').value = DEFAULTS.receiptNo;
    $('proviso').value = DEFAULTS.proviso;
    $('amountMode').value = DEFAULTS.amountMode;
    $('amountTotal').value = comma(DEFAULTS.amountTotal);
    $('amount10').value = comma(DEFAULTS.amount10);
    $('amount8').value = comma(DEFAULTS.amount8);
    $('showTax').checked = DEFAULTS.showTax;
    $('taxRateIncluded').value = DEFAULTS.taxRateIncluded;
    $('useDaiji').checked = DEFAULTS.useDaiji;
    $('issuerName').value = DEFAULTS.issuerName;
    $('issuerAddress').value = DEFAULTS.issuerAddress;
    $('issuerTel').value = DEFAULTS.issuerTel;
    $('regNumber').value = DEFAULTS.regNumber;
    $('notes').value = DEFAULTS.notes;
    $('issueDate').value = todayISO();
  }

  function refresh() {
    updateModeVisibility();
    updateRegNumberState();
    renderPreview();
  }

  function resetForm() {
    applyFieldDefaults();
    refresh();
  }

  /* ---------------------------------------------------------
     初期化
     --------------------------------------------------------- */

  function init() {
    applyFieldDefaults();

    // 登録番号は入力を半角に正規化しつつ検証
    var regInput = $('regNumber');
    regInput.addEventListener('input', function () {
      var half = toHalfWidth(regInput.value).toUpperCase();
      if (half !== regInput.value) {
        var pos = regInput.selectionStart;
        regInput.value = half;
        try { regInput.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
      }
      refresh();
    });
    regInput.addEventListener('blur', function () {
      var normalized = normalizeRegNumber(regInput.value);
      if (/^T\d{13}$/.test(normalized)) {
        regInput.value = normalized;
        refresh();
      }
    });

    $('receiptForm').addEventListener('input', refresh);
    $('receiptForm').addEventListener('change', refresh);

    // 金額欄はフォーカスが外れたときに整形する
    ['amountTotal', 'amount10', 'amount8'].forEach(function (id) {
      $(id).addEventListener('focusout', function (event) {
        formatAmountField(event.target);
      });
    });

    $('printBtn').addEventListener('click', function () {
      window.print();
    });

    $('resetBtn').addEventListener('click', resetForm);

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
