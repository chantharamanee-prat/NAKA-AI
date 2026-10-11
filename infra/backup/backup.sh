#!/bin/sh
# Daily PostgreSQL backups for the whole naka database (docker-compose.yml service "backup").
#
#   /backups/naka-YYYYMMDD-HHMM.dump   pg_dump custom format: restore with
#                                      pg_restore -d naka --clean --if-exists /backups/<file>
#   /backups/last.json                 the latest run, read by the back office (สถานะเซิร์ฟเวอร์)
#
# A dump is written to a .partial file and renamed only when pg_dump succeeded, so a file named *.dump is always
# complete. Dumps older than BACKUP_KEEP_DAYS are removed after a successful run. Every run is logged.
set -u
EVERY_HOURS="${BACKUP_EVERY_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DIR=/backups
mkdir -p "$DIR"

run() {
  stamp=$(date +%Y%m%d-%H%M)
  file="$DIR/naka-$stamp.dump"
  started=$(date +%s)
  # owners and grants are kept: a restore as the superuser gives each app its own schema back
  if pg_dump --format=custom --file="$file.partial" naka 2>"$DIR/last-error.log"; then
    mv "$file.partial" "$file"
    size=$(wc -c < "$file" | tr -d ' ')
    find "$DIR" -name 'naka-*.dump' -mtime +"$KEEP_DAYS" -delete
    rm -f "$DIR/last-error.log"
    printf '{"ok":true,"at":%s,"file":"%s","bytes":%s,"seconds":%s,"keepDays":%s,"everyHours":%s}\n' \
      "$(date +%s)" "$(basename "$file")" "$size" "$(( $(date +%s) - started ))" "$KEEP_DAYS" "$EVERY_HOURS" > "$DIR/last.json.tmp"
    echo "backup: $(basename "$file") $size bytes"
  else
    rm -f "$file.partial"
    printf '{"ok":false,"at":%s,"error":"pg_dump failed (see last-error.log)","keepDays":%s,"everyHours":%s}\n' \
      "$(date +%s)" "$KEEP_DAYS" "$EVERY_HOURS" > "$DIR/last.json.tmp"
    echo "backup: FAILED" >&2
  fi
  mv "$DIR/last.json.tmp" "$DIR/last.json"
}

# wait for the database, then back up now and every EVERY_HOURS hours
until pg_isready -q; do sleep 5; done
while true; do
  run
  sleep $(( EVERY_HOURS * 3600 ))
done
