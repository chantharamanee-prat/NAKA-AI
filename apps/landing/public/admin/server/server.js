// สถานะเซิร์ฟเวอร์: GET /api/admin/server (src/admin/server-status.ts, server/server-info.ts).
(function () {
  'use strict';
  var A = window.NakaAdmin, $ = A.$, el = A.el;
  var BACKUP_LATE = 36 * 3600; // a daily backup older than a day and a half has missed a run
  var SCHEMA = { account: 'naka-ai', studio: 'Naka Studio', reporting: 'รายงาน' };

  function bytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '?';
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (n >= 1024 * 1024) return Math.round(n / 1024 / 1024) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function ago(seconds) {
    if (seconds < 90) return 'เมื่อสักครู่';
    if (seconds < 5400) return Math.round(seconds / 60) + ' นาทีที่แล้ว';
    if (seconds < 172800) return Math.round(seconds / 3600) + ' ชั่วโมงที่แล้ว';
    return Math.round(seconds / 86400) + ' วันที่แล้ว';
  }
  function duration(s) { var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600); return d ? d + ' วัน ' + h + ' ชม.' : h ? h + ' ชม. ' + Math.floor(s % 3600 / 60) + ' นาที' : Math.floor(s / 60) + ' นาที'; }
  function stat(id, value, sub, tone) { $(id).textContent = value; $(id).className = 'stat-value' + (tone ? ' ' + tone : ''); $(id + '-sub').textContent = sub; }
  function usage(list, label, used, total, note) {
    var li = el('li'); var share = total ? used / total : 0;
    var track = el('span', null, 'track' + (share > 0.9 ? ' bad' : share > 0.8 ? ' warn' : '')); var fill = el('span');
    fill.style.width = Math.max(1, Math.round(share * 100)) + '%'; track.append(fill);
    li.append(el('span', label), el('b', total ? bytes(used) + ' จาก ' + bytes(total) + ' (' + Math.round(share * 100) + '%)' : bytes(used)), track);
    if (note) li.append(el('small', note));
    list.append(li);
  }

  function render(s) {
    var alerts = $('alerts'); alerts.replaceChildren();
    function alert(text, tone) { var li = el('li'); li.append(el('span', text, 'alert' + (tone ? ' ' + tone : ''))); alerts.append(li); }

    // cron
    // a heartbeat that cannot be read (e.g. migration 0011 not run yet) is "unknown", not "stopped"
    if (!s.heartbeats.ok) stat('s-cron', '?', 'อ่านสัญญาณไม่ได้: ' + s.heartbeats.error, '');
    else if (s.cron.lastAt === null) stat('s-cron', 'ไม่เคยทำงาน', 'ยังไม่มีสัญญาณจากตัวทำงานเบื้องหลัง', 'bad');
    else stat('s-cron', s.cron.running ? 'ทำงานอยู่' : 'หยุด', 'ล่าสุด ' + ago(s.now - s.cron.lastAt) + ' · ' + A.when(s.cron.lastAt), s.cron.running ? 'ok' : 'bad');
    if (s.heartbeats.ok && !s.cron.running) alert('ตัวทำงานเบื้องหลังไม่ได้ทำงาน: คิวงาน การเติมเครดิตรายเดือน และการโพสต์ตามเวลาจะหยุด ตรวจ container landing (NAKA_ROLE)', 'bad');

    // backups
    var server = s.server.ok ? s.server.data : null, backups = server && server.backups;
    var list = $('backups'); list.replaceChildren();
    if (!server) { stat('s-backup', '?', s.server.error, ''); $('backup-note').textContent = s.server.error; }
    else if (!backups.configured) {
      stat('s-backup', 'ยังไม่ได้ตั้ง', 'ไม่มี BACKUP_DIR', 'bad');
      $('backup-note').textContent = 'ยังไม่ได้ตั้งการสำรองข้อมูลอัตโนมัติ: deploy ด้วย docker-compose.yml รุ่นล่าสุด (service backup) แล้วรีสตาร์ต landing';
      alert('ยังไม่มีการสำรองข้อมูลอัตโนมัติ', 'bad');
    } else {
      var last = backups.last, newest = backups.files[0];
      var age = newest ? s.now - newest.at : null;
      if (last && last.ok === false) { stat('s-backup', 'ล้มเหลว', 'ครั้งล่าสุด ' + A.when(last.at) + ' ดู last-error.log ในโฟลเดอร์สำรอง', 'bad'); alert('สำรองข้อมูลครั้งล่าสุดล้มเหลว', 'bad'); }
      else if (!newest) { stat('s-backup', 'ยังไม่มี', 'รอการสำรองครั้งแรก', 'bad'); alert('ยังไม่มีไฟล์สำรองข้อมูล', 'bad'); }
      else {
        stat('s-backup', ago(age), bytes(newest.bytes) + ' · ' + A.when(newest.at), age > BACKUP_LATE ? 'bad' : 'ok');
        if (age > BACKUP_LATE) alert('สำรองข้อมูลล่าสุดเมื่อ ' + ago(age) + ' เกินรอบปกติ ตรวจ container backup', 'bad');
      }
      $('backup-note').textContent = last ? 'สำรองทุก ' + (last.everyHours || 24) + ' ชั่วโมง เก็บไว้ ' + (last.keepDays || 14) + ' วัน · ไฟล์สำรองอยู่บนเครื่องเดียวกัน ควรคัดลอกออกไปเก็บที่อื่นด้วย' : '';
      backups.files.forEach(function (f) {
        var li = el('li', null, 'record'); var main = el('div');
        main.append(el('p', f.name, 'record-title'), el('p', A.when(f.at), 'record-meta'));
        var end = el('div', null, 'record-end'); end.append(el('b', bytes(f.bytes)));
        li.append(main, el('div'), end); list.append(li);
      });
      if (!backups.files.length) list.append(el('li', 'ยังไม่มีไฟล์สำรอง', 'empty'));
    }

    // database
    if (s.database.ok) {
      var d = s.database.data;
      stat('s-db', bytes(d.bytes), A.num(d.connections) + ' การเชื่อมต่อ', '');
      var schemas = $('schemas'); schemas.replaceChildren();
      d.schemas.forEach(function (x) { usage(schemas, SCHEMA[x.schema] || x.schema, x.bytes, d.bytes); });
      var tables = $('tables'); tables.replaceChildren();
      d.biggestTables.forEach(function (t) { var tr = el('tr'); tr.append(el('td', t.name), el('td', A.num(t.rows), 'num'), el('td', bytes(t.bytes), 'num')); tables.append(tr); });
    } else stat('s-db', '?', s.database.error, 'bad');

    // the app and its disks
    var disks = $('disks'); disks.replaceChildren();
    if (server) {
      var p = server.process;
      stat('s-app', duration(p.uptimeSeconds), 'หน่วยความจำ ' + bytes(p.rssBytes) + ' · Node ' + p.node + ' · ' + p.role + (p.version ? ' · v' + p.version : ''), '');
      server.disks.forEach(function (x) {
        usage(disks, x.name, x.totalBytes - x.freeBytes, x.totalBytes, x.path);
        if (x.totalBytes && x.freeBytes / x.totalBytes < 0.1) alert('ดิสก์ ' + x.name + ' เหลือไม่ถึง 10%', 'bad');
      });
      if (!server.disks.length) disks.append(el('li', 'ไม่มีข้อมูลดิสก์', 'muted'));
    } else { stat('s-app', '?', s.server.error, ''); disks.append(el('li', s.server.error, 'muted')); }

    if (!alerts.children.length) alert('ทุกอย่างปกติ', 'ok');
    $('board').hidden = false;
  }

  async function load() {
    A.message($('status'), 'กำลังตรวจ…');
    try { render(await A.api('/server')); A.message($('status'), ''); }
    catch (error) { if (!A.quiet(error)) A.message($('status'), error.message, true); }
  }
  $('refresh').addEventListener('click', load);
  A.start(load);
})();
