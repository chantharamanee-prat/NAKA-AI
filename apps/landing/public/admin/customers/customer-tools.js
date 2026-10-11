// จัดการลูกค้า, the care tools around customers.js (src/admin/customer-tools.ts): notes and tags, the list as CSV,
// credits for the picked customers, and the customer's data exported or erased (PDPA). customers.js tells this
// file what is shown through the 'naka:customers' and 'naka:customer' events; sign-in stays with customers.js.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'naka_admin_customers';
  var current = null, role = 'owner';

  function el(tag, text, className) { var n = document.createElement(tag); if (text != null) n.textContent = String(text); if (className) n.className = className; return n; }
  function say(id, text, error) { $(id).textContent = text || ''; $(id).classList.toggle('error', !!error); }
  function when(t) { return new Date(t * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }); }
  /** the same sign-in as customers.js: a Google admin cookie, or the break-glass token in this tab */
  async function request(route, init) {
    var token = ''; try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* none */ }
    init = init || {};
    var headers = Object.assign({}, init.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
    if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; init = Object.assign({}, init, { body: JSON.stringify(init.json) }); }
    var response = await fetch('/api/admin' + route, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init, { headers: headers }));
    if (!response.ok) {
      var body = await response.clone().json().catch(function () { return {}; });
      throw new Error(typeof body.error === 'string' ? body.error : 'ทำรายการไม่สำเร็จ (HTTP ' + response.status + ')');
    }
    return response;
  }
  async function api(route, init) { return (await request(route, init)).json(); }
  async function save(response, fallback) {
    var name = (/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '') || [])[1] || fallback;
    var url = URL.createObjectURL(await response.blob());
    var a = el('a'); a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------- the list: CSV and bulk credits ----------
  function picked() { return Array.prototype.map.call(document.querySelectorAll('#customer-list .pick input:checked'), function (b) { return b.value; }); }
  function syncPicked() {
    var n = picked().length;
    $('bulk-open').disabled = !n;
    $('bulk-open').textContent = n ? 'เติมเครดิตให้ที่เลือก (' + n + ' คน)' : 'เติมเครดิตให้ที่เลือก';
    if (!n) $('bulk-form').hidden = true;
    $('bulk-who').textContent = 'เติมให้ลูกค้า ' + n + ' คนที่เลือก คนละเท่ากัน บันทึกในประวัติของแต่ละคน';
  }
  document.addEventListener('naka:customers', function () { $('pick-all').checked = false; syncPicked(); });
  $('customer-list').addEventListener('change', syncPicked);
  $('pick-all').addEventListener('change', function () {
    document.querySelectorAll('#customer-list .pick input').forEach(function (b) { b.checked = $('pick-all').checked; });
    syncPicked();
  });
  $('bulk-open').addEventListener('click', function () { $('bulk-form').hidden = false; $('bulk-note').focus(); });
  $('bulk-cancel').addEventListener('click', function () { $('bulk-form').hidden = true; });
  $('bulk-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var ids = picked(), amount = Number($('bulk-amount').value);
    $('bulk-submit').disabled = true; say('tools-status', 'กำลังเติมเครดิต…');
    try {
      var r = await api('/customers/bulk-credits', { method: 'POST', json: { userIds: ids, amount: amount, note: $('bulk-note').value } });
      say('tools-status', 'เติม ' + r.amount + ' เครดิตให้ลูกค้า ' + r.customers + ' คนแล้ว');
      $('bulk-form').hidden = true; $('bulk-note').value = '';
      $('search-form').requestSubmit(); // the list shows the new balances
    } catch (error) { say('tools-status', error.message, true); }
    finally { $('bulk-submit').disabled = false; }
  });
  $('csv').addEventListener('click', async function () {
    var q = new URLSearchParams({ q: $('query').value.trim(), tag: $('tag-filter').value.trim() });
    $('csv').disabled = true; say('tools-status', 'กำลังเตรียมไฟล์…');
    try { await save(await request('/customers.csv?' + q), 'naka-ai-customers.csv'); say('tools-status', 'ดาวน์โหลดแล้ว'); }
    catch (error) { say('tools-status', error.message, true); }
    finally { $('csv').disabled = false; }
  });

  // ---------- one customer: notes and tags ----------
  function renderCare(extras) {
    var tags = $('tags'); tags.replaceChildren();
    if (!extras.tags.length) tags.append(el('span', 'ยังไม่มีป้าย', 'muted'));
    extras.tags.forEach(function (tag) {
      var chip = el('span', null, 'chip removable'); chip.append(el('span', tag));
      var x = el('button', '×'); x.type = 'button'; x.setAttribute('aria-label', 'เอาป้าย ' + tag + ' ออก');
      x.addEventListener('click', function () { change('/customers/' + encodeURIComponent(current.id) + '/tags/' + encodeURIComponent(tag), { method: 'DELETE' }, 'เอาป้าย ' + tag + ' ออกแล้ว'); });
      chip.append(x); tags.append(chip);
    });
    var notes = $('notes'); notes.replaceChildren();
    extras.notes.forEach(function (n) {
      var li = el('li', null, 'record');
      var main = el('div'); main.append(el('p', n.body, 'preserve-lines'), el('p', n.author + ' · ' + when(n.createdAt), 'record-meta'));
      var end = el('div', null, 'record-end');
      var del = el('button', 'ลบ', 'btn-sm'); del.type = 'button';
      del.addEventListener('click', function () { change('/customers/' + encodeURIComponent(current.id) + '/notes/' + encodeURIComponent(n.id), { method: 'DELETE' }, 'ลบโน้ตแล้ว'); });
      end.append(del); li.append(main, el('div'), end); notes.append(li);
    });
  }
  async function change(route, init, done) {
    try { renderCare(await api(route, init)); say('mutation-status', done); }
    catch (error) { say('mutation-status', error.message, true); }
  }
  $('tag-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var tag = $('tag-input').value.trim(); if (!tag || !current) return;
    change('/customers/' + encodeURIComponent(current.id) + '/tags', { method: 'POST', json: { tag: tag } }, 'เพิ่มป้าย ' + tag + ' แล้ว').then(function () { $('tag-input').value = ''; });
  });
  $('note-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var body = $('note-input').value.trim(); if (!body || !current) return;
    change('/customers/' + encodeURIComponent(current.id) + '/notes', { method: 'POST', json: { body: body } }, 'บันทึกโน้ตแล้ว').then(function () { $('note-input').value = ''; });
  });

  // ---------- one customer: PDPA ----------
  var TABLES = { auth_identities: 'ช่องทางเข้าสู่ระบบ (อีเมล เบอร์โทร)', auth_passwords: 'รหัสผ่าน', sessions: 'การเข้าสู่ระบบที่เปิดอยู่',
    social_accounts: 'เพจที่เชื่อม', social_media: 'คลิปรอโพสต์', scheduled_posts: 'โพสต์ตั้งเวลา', inbox_threads: 'แชตลูกค้าของร้าน', inbox_messages: 'ข้อความในแชต',
    inbox_kb: 'ข้อมูลร้านสำหรับตอบแชต', inbox_settings: 'การตั้งค่าแชต', jobs: 'งานสร้าง', ai_videos: 'วิดีโอ AI', marketer_media: 'ไฟล์ที่อัปโหลด',
    user_features: 'ฟีเจอร์รายคน', feature_usage: 'สถิติการใช้ฟีเจอร์', customer_notes: 'โน้ตภายใน', customer_tags: 'ป้าย', subscriptions: 'แพ็กเกจ',
    payments: 'การชำระเงิน', receipts: 'ใบเสร็จ', credit_ledger: 'ประวัติเครดิต', admin_audit: 'บันทึกการจัดการ' };
  function list(id, rows) {
    var ul = $(id); ul.replaceChildren();
    Object.keys(rows).forEach(function (t) { ul.append(el('li', (TABLES[t] || t) + ' ' + rows[t] + ' รายการ')); });
    if (!ul.children.length) ul.append(el('li', 'ไม่มี', 'muted'));
  }
  $('erase-preview').addEventListener('click', async function () {
    if (!current) return;
    $('erase-preview').disabled = true; say('mutation-status', 'กำลังตรวจข้อมูล…');
    try {
      var p = await api('/customers/' + encodeURIComponent(current.id) + '/erase-preview');
      if (p.erased) { say('mutation-status', 'ข้อมูลของลูกค้านี้ถูกลบไปแล้ว'); return; }
      list('erase-remove', p.remove); list('erase-keep', p.keep);
      $('erase-studio').textContent = !p.studio.connected ? 'ยังไม่ได้เชื่อม naka-studio จึงลบเฉพาะใน naka-ai'
        : p.studio.error ? 'อ่านข้อมูลจาก naka-studio ไม่ได้: ' + p.studio.error + ' (ลบไม่ได้จนกว่าจะเชื่อมได้)'
        : 'ใน Naka Studio จะลบ ' + p.studio.counts.total + ' รายการ พร้อมไฟล์รูปและวิดีโอ';
      $('erase-id').textContent = current.id; $('erase-detail').hidden = false; say('mutation-status', '');
    } catch (error) { say('mutation-status', error.message, true); }
    finally { $('erase-preview').disabled = false; }
  });
  $('erase-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!current) return;
    say('mutation-status', 'กำลังลบข้อมูล…');
    try {
      var r = await api('/customers/' + encodeURIComponent(current.id) + '/erase', { method: 'POST', json: { confirm: $('erase-confirm').value.trim(), note: $('erase-note').value } });
      var removed = Object.keys(r.removed).reduce(function (n, k) { return n + r.removed[k]; }, 0);
      say('mutation-status', 'ลบข้อมูลแล้ว ' + removed + ' รายการใน naka-ai' + (r.studio && r.studio.total !== undefined ? ' และ ' + r.studio.total + ' รายการใน Studio' : '') + ' เก็บข้อมูลการเงินไว้ตามกฎหมาย');
      $('erase-detail').hidden = true; $('erase-confirm').value = ''; $('erase-note').value = '';
      $('search-form').requestSubmit();
    } catch (error) { say('mutation-status', error.message, true); }
  });
  $('export-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!current) return;
    say('mutation-status', 'กำลังรวบรวมข้อมูล…');
    try {
      await save(await request('/customers/' + encodeURIComponent(current.id) + '/export', { method: 'POST', json: { note: $('export-note').value } }), 'customer.json');
      say('mutation-status', 'ดาวน์โหลดข้อมูลแล้ว และบันทึกไว้ในประวัติ'); $('export-note').value = '';
    } catch (error) { say('mutation-status', error.message, true); }
  });

  document.addEventListener('naka:customer', function (event) {
    current = event.detail.customer;
    renderCare({ tags: event.detail.tags || [], notes: event.detail.notes || [] });
    $('erase-detail').hidden = true;
    $('erase-form').hidden = !!event.detail.erased;
  });

  // support staff: the owner-only tools are hidden (the server refuses them anyway, src/admin/auth.ts supportMay)
  // asked once the list has loaded, so a sign-in on this page counts too
  var roleChecked = false;
  document.addEventListener('naka:customers', function () {
    if (roleChecked) return;
    roleChecked = true;
    request('/me').then(function (r) { return r.json(); }).then(function (me) {
      role = me.role || 'owner';
      if (role !== 'owner') document.querySelectorAll('[data-owner-only]').forEach(function (n) { n.hidden = true; });
    }).catch(function () { roleChecked = false; });
  });
})();
