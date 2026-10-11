// รายงาน: GET /api/admin/reports?months= (src/admin/reports.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var KIND = { affiliate_review: 'คลิปรีวิว', ai_video: 'วิดีโอ AI', inbox_reply: 'ตอบแชต AI Inbox',
    marketer_insight: 'นักการตลาด AI: วิเคราะห์', marketer_bulk: 'นักการตลาด AI: หลายชิ้น', marketer_recreate: 'นักการตลาด AI: ทำซ้ำคลิป' };
  function monthName(key) { return new Date(key + '-01T00:00:00+07:00').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'short', year: '2-digit' }); }
  function pct(part, whole) { return whole ? Math.round(part / whole * 100) + '%' : '0%'; }
  function text(id, value) { $(id).textContent = value; }
  function cells(tr, values) { values.forEach(function (v, i) { tr.append(el('td', v, i ? 'num' : '')); }); return tr; }

  function render(r) {
    var sum = function (f) { return r.monthly.reduce(function (n, m) { return n + m[f]; }, 0); };
    text('s-mrr', A.baht(r.now.mrr)); text('s-mrr-sub', A.num(r.now.subscriptions) + ' แพ็กเกจที่ใช้อยู่ตอนนี้ · แพ็กรายปีนับ 1/12');
    text('s-revenue', A.baht(sum('revenue'))); text('s-revenue-sub', A.num(sum('payments')) + ' รายการ · ' + r.months.length + ' เดือน');
    text('s-conv', pct(r.funnel.paid, r.funnel.signed)); text('s-conv-sub', A.num(r.funnel.paid) + ' จาก ' + A.num(r.funnel.signed) + ' คนที่สมัครในช่วงนี้');
    text('s-ended', A.num(sum('ended'))); text('s-ended-sub', 'แพ็กเกจที่หมดในช่วงนี้แล้วยังไม่ต่อ');

    var funnel = $('funnel'); funnel.replaceChildren();
    [['สมัคร', r.funnel.signed], ['ใช้เครดิตแล้ว', r.funnel.used], ['จ่ายเงินแล้ว', r.funnel.paid]].forEach(function (step) {
      var li = el('li'); var track = el('span', null, 'track'); var fill = el('span');
      fill.style.width = (r.funnel.signed ? Math.round(step[1] / r.funnel.signed * 100) : 0) + '%';
      track.append(fill);
      li.append(el('span', step[0]), el('b', A.num(step[1]) + ' คน · ' + pct(step[1], r.funnel.signed)), track);
      funnel.append(li);
    });

    var monthly = $('monthly'); monthly.replaceChildren();
    r.monthly.forEach(function (m) {
      monthly.append(cells(el('tr'), [monthName(m.month), A.num(m.signups), A.num(m.firstPayers), A.num(m.payers), A.baht(m.revenue), A.num(m.ended), A.num(m.creditsLanding), A.num(m.creditsStudio)]));
    });
    monthly.append(cells(el('tr'), ['รวม', A.num(sum('signups')), A.num(sum('firstPayers')), '', A.baht(sum('revenue')), A.num(sum('ended')), A.num(sum('creditsLanding')), A.num(sum('creditsStudio'))]));

    var features = $('features'); features.replaceChildren();
    if (!r.features.length) features.append(el('caption', 'ยังไม่มีการใช้ฟีเจอร์ที่มีโควตาในช่วงนี้', 'muted'));
    else {
      var shown = r.months.slice(-4); // the latest four months fit a phone
      var head = el('tr'); head.append(el('th', 'ฟีเจอร์')); shown.forEach(function (m) { head.append(el('th', monthName(m), 'num')); });
      var thead = el('thead'); thead.append(head); var tbody = el('tbody');
      r.features.forEach(function (f) {
        var tr = el('tr'); tr.append(el('td', f.label));
        shown.forEach(function (m) { var v = f.months[m]; tr.append(el('td', v ? A.num(v.used) + ' (' + A.num(v.users) + ')' : '0', 'num')); });
        tbody.append(tr);
      });
      features.append(thead, tbody);
    }

    var jobs = $('jobs'); jobs.replaceChildren();
    if (!r.jobs.length) { var none = el('tr'); var td = el('td', 'ยังไม่มีงานในช่วงนี้', 'muted'); td.colSpan = 4; none.append(td); jobs.append(none); }
    r.jobs.forEach(function (j) {
      var tr = cells(el('tr'), [KIND[j.kind] || j.kind, A.num(j.total), A.num(j.failed) + ' (' + pct(j.failed, j.total) + ')', A.num(j.users)]);
      if (j.failed / j.total > 0.2) tr.children[2].classList.add('bad');
      jobs.append(tr);
    });

    var top = $('top'); top.replaceChildren();
    if (!r.top.length) top.append(el('li', 'ยังไม่มีการชำระเงินในช่วงนี้', 'empty'));
    r.top.forEach(function (c, i) {
      var li = el('li', null, 'record'); var main = el('div'); var title = el('p', null, 'record-title');
      var a = el('a', (i + 1) + '. ' + (c.name || 'ไม่มีชื่อ')); a.href = '/admin/customers/?customer=' + encodeURIComponent(c.userId);
      title.append(a); main.append(title, el('p', A.num(c.payments) + ' รายการ', 'record-meta'));
      var end = el('div', null, 'record-end'); end.append(el('b', A.baht(c.revenue)));
      li.append(main, end); top.append(li);
    });
    $('report').hidden = false;
  }

  async function load() {
    A.message($('status'), 'กำลังคำนวณ…');
    try { render(await A.api('/reports?months=' + $('months').value)); A.message($('status'), ''); }
    catch (error) { if (!A.quiet(error)) A.message($('status'), error.message, true); }
  }
  $('months').addEventListener('change', load);
  A.start(load);
})();
