'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGroupKey(label) {
  const normalized = label.toLowerCase().trim();
  const match = normalized.match(/^autolabel_(\d+)/);
  return match ? `autolabel_${match[1]}` : normalized;
}
function isBaseVersion(label) {
  return /^autolabel_\d+[a-z]?$/.test(label.toLowerCase().trim());
}
function getSubKey(label) {
  const m = label.toLowerCase().trim().match(/^autolabel_\d+([a-z])?$/);
  return m ? (m[1] || '') : '';
}

function parseIAS(iasText, htmlMap) {
  const lines = iasText.split('\n').filter(l => l.trim());
  const data = lines[0].startsWith('#') ? lines.slice(1) : lines;
  const entries = data.map((line, i) => {
    const p = line.split('\t');
    if (p.length < 9) return null;
    const start = Math.abs(+p[0]), end = Math.abs(+p[1]);
    return { start, end, duration: end - start, label: p[8].trim(), order: i };
  }).filter(Boolean);

  const groups = {};
  entries.forEach(e => {
    const key = getGroupKey(e.label);
    if (!groups[key]) {
      groups[key] = { groupKey: key, start: e.start, end: e.end, order: e.order, baseEntries: [] };
    } else {
      groups[key].start = Math.min(groups[key].start, e.start);
      groups[key].end   = Math.max(groups[key].end, e.end);
      groups[key].order = Math.min(groups[key].order, e.order);
    }
    if (isBaseVersion(e.label)) groups[key].baseEntries.push(e);
  });

  return Object.values(groups)
    .map(g => {
      let html = '';
      if (g.baseEntries.length) {
        g.baseEntries.sort((a,b) => getSubKey(a.label).localeCompare(getSubKey(b.label)));
        html = g.baseEntries.map(e => htmlMap[e.label] || '').join('<br/>');
      } else {
        const fall = entries.find(x => getGroupKey(x.label) === g.groupKey);
        html = htmlMap[fall.label] || '';
      }
      return {
        groupKey: g.groupKey,
        start: g.start,
        end: g.end,
        duration: g.end - g.start,
        html,
        charCount: html.length,
      };
    })
    .sort((a,b) => a.start - b.start);
}

function parseIAReport(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return {};
  const hdr = lines[0].replace(/^\uFEFF/,'').split('\t').map(h => h.toLowerCase());
  const li = hdr.indexOf('ia_label');
  const fi = hdr.indexOf('ia_fixation_count');
  const di = hdr.indexOf('ia_dwell_time');
  if (li<0||fi<0) return {};
  const map = {};
  lines.slice(1).forEach(l => {
    const p = l.split('\t').map(s=>s.trim());
    const label = p[li], fc = parseFloat(p[fi]), dwell = di>=0?parseFloat(p[di]):0;
    if (isNaN(fc)) return;
    const key = getGroupKey(label);
    if (!map[key]) map[key] = { viewed:false, dwellTime:0 };
    if (fc>0) map[key].viewed = true;
    map[key].dwellTime += isNaN(dwell)?0:dwell;
  });
  return map;
}

function parseSessionLog(text) {
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  let offset = null;
  for (const l of lines) {
    const p = l.split('\t');
    if (p[3]?.includes('Screen Recording: Starting component Screen Recording')) {
      offset = +p[1];
      break;
    }
  }
  if (offset === null) return { offset: null, events: [] };
  const ev = [];
  lines.forEach(l => {
    const p = l.split('\t');
    const ts = +p[1];
    if (ts < offset) return;
    if (p[3]?.includes('KeyDown [Tab] 9')) {
      ev.push({ relative: ts - offset });
    }
  });
  return { offset, events: ev };
}

async function computeRegions(participantId) {
  const [iasRes, htmlRes, iaRes, logRes] = await Promise.all([
    fetch(`/${participantId}/output_${participantId}.ias`),
    fetch(`/${participantId}/html_${participantId}.json`),
    fetch(`/${participantId}/IA_Report_${participantId}.txt`),
    fetch(`/${participantId}/SessionLog_${participantId}.log`),
  ]);
  if (!iasRes.ok || !htmlRes.ok || !iaRes.ok || !logRes.ok) {
    throw new Error('One or more files failed to load');
  }
  const [iasText, htmlMap, iaText, logText] = await Promise.all([
    iasRes.text(), htmlRes.json(), iaRes.text(), logRes.text()
  ]);

  const regions = parseIAS(iasText, htmlMap);
  const iaMap   = parseIAReport(iaText);
  const { events } = parseSessionLog(logText);

  return regions.map(r => ({
    start: r.start,
    duration: r.duration,
    accepted: events.some(e => e.relative >= r.start && e.relative <= r.end),
    dwellTime: iaMap[r.groupKey]?.dwellTime || 0,
    charCount: r.charCount,
  }));
}

// ── Index Component ─────────────────────────────────────────────────────────

export default function ReportIndex({ participantId }) {
  const participants = [
    'tarek5','040301','040302','050302','050303','050304','060301','070301',
    '100301','100302','110301','120301','120302','130301','130302','140302',
    '190301','200301','200302','210201','210301','210302'
  ];

  const [allRegionsByPart, setAllRegionsByPart] = useState({});
  const [errorsByPart, setErrorsByPart]       = useState({});
  const [loading, setLoading]                 = useState(true);

  const [filterAccepted, setFilterAccepted]   = useState(false);
  const [filterDwellTime, setFilterDwellTime] = useState(false);
  const [durationThreshold, setDurationThreshold] = useState('');
  const [dwellThreshold, setDwellThreshold]       = useState('');

  useEffect(() => {
    let alive = true;
    async function fetchAll() {
      const results = await Promise.all(participants.map(id =>
        computeRegions(id)
          .then(regs => ({ id, regs }))
          .catch(err => ({ id, error: err.message || 'loading failed' }))
      ));
      if (!alive) return;

      const regionsObj = {};
      const errorsObj  = {};
      results.forEach(r => {
        if (r.error) errorsObj[r.id] = r.error;
        else         regionsObj[r.id] = r.regs;
      });

      setAllRegionsByPart(regionsObj);
      setErrorsByPart(errorsObj);
      setLoading(false);
    }
    fetchAll();
    return () => { alive = false; };
  }, []);

  // ─── Compute per-participant stats + fullMaxEnd ──────────────────────────
  const statsList = useMemo(() => {
    const summarize = arr => {
      if (!arr.length) return { avg:0, min:0, max:0 };
      const sum = arr.reduce((a,b)=>a+b,0);
      return { avg: sum/arr.length, min: Math.min(...arr), max: Math.max(...arr) };
    };

    return participants.map(id => {
      if (errorsByPart[id]) {
        return { participantId: id, error: errorsByPart[id] };
      }

      const regs = allRegionsByPart[id] || [];
      // full experiment end time
      const fullMaxEnd = regs.length
        ? Math.max(...regs.map(r => r.start + r.duration))
        : 0;

      // apply filters
      const filtered = regs.filter(r => {
        if (filterAccepted   && !r.accepted)       return false;
        if (filterDwellTime  && r.dwellTime <= 0)   return false;
        if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
        if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
        return true;
      });

      const total = filtered.length;
      const acceptedCount = filtered.filter(r => r.accepted).length;
      const notAcceptedCount = total - acceptedCount;
      const pct = x => total>0 ? (x/total*100) : 0;

      return {
        participantId: id,
        fullMaxEnd,
        filteredRegions: filtered,
        total,
        acceptedCount,
        acceptedPct: pct(acceptedCount),
        notAcceptedCount,
        notAcceptedPct: pct(notAcceptedCount),
        durationSummary: summarize(filtered.map(r=>r.duration)),
        dwellSummary:   summarize(filtered.map(r=>r.dwellTime)),
      };
    });
  }, [
    allRegionsByPart, errorsByPart,
    filterAccepted, filterDwellTime,
    durationThreshold, dwellThreshold
  ]);

  const overall = useMemo(() => {
    const summarize = arr => {
      if (!arr.length) return { avg:0, min:0, max:0 };
      const sum = arr.reduce((a,b)=>a+b,0);
      return { avg: sum/arr.length, min: Math.min(...arr), max: Math.max(...arr) };
    };
    const allRegs = Object.values(allRegionsByPart).flat();
    const fr = allRegs.filter(r => {
      if (filterAccepted   && !r.accepted)       return false;
      if (filterDwellTime  && r.dwellTime <= 0)   return false;
      if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
      return true;
    });
    const total = fr.length;
    const acceptedCount = fr.filter(r=>r.accepted).length;
    const notAcceptedCount = total - acceptedCount;
    const pct = x => total>0 ? (x/total*100) : 0;
    return {
      total,
      acceptedCount,
      acceptedPct: pct(acceptedCount),
      notAcceptedCount,
      notAcceptedPct: pct(notAcceptedCount),
      durationSummary: summarize(fr.map(r=>r.duration)),
      dwellSummary:   summarize(fr.map(r=>r.dwellTime)),
    };
  }, [
    allRegionsByPart,
    filterAccepted, filterDwellTime,
    durationThreshold, dwellThreshold
  ]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">All Participants Summary</h1>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {/* Filters */}
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filterAccepted}
                onChange={e => setFilterAccepted(e.target.checked)}
              />
              Accepted
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filterDwellTime}
                onChange={e => setFilterDwellTime(e.target.checked)}
              />
              Dwelltime &gt; 0
            </label>
            <label className="flex items-center gap-2">
              Min Duration (ms):
              <input
                type="number"
                value={durationThreshold}
                onChange={e => setDurationThreshold(e.target.value)}
                placeholder="e.g. 500"
                className="ml-2 w-24 border rounded p-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              Min Dwelltime (ms):
              <input
                type="number"
                value={dwellThreshold}
                onChange={e => setDwellThreshold(e.target.value)}
                placeholder="e.g. 200"
                className="ml-2 w-24 border rounded p-1 text-sm"
              />
            </label>
          </div>

          {/* Overall Summary */}
          {overall && (
            <div className="p-4 mb-4 bg-gray-50 border rounded">
              <h2 className="text-xl font-semibold mb-2">Overall (Filtered) Summary</h2>
              <div className="flex flex-wrap gap-6 text-sm">
                <div><strong>Total Suggestions:</strong> {overall.total}</div>
                <div>
                  <strong>Accepted:</strong> {overall.acceptedCount} ({overall.acceptedPct.toFixed(1)}%)
                </div>
                <div>
                  <strong>Not Accepted:</strong> {overall.notAcceptedCount} ({overall.notAcceptedPct.toFixed(1)}%)
                </div>
                <div>
                  <strong>Dur(ms):</strong> avg {overall.durationSummary.avg.toFixed(1)}, 
                  min {overall.durationSummary.min}, max {overall.durationSummary.max}
                </div>
                <div>
                  <strong>Dwell(ms):</strong> avg {overall.dwellSummary.avg.toFixed(1)}, 
                  min {overall.dwellSummary.min}, max {overall.dwellSummary.max}
                </div>
              </div>
            </div>
          )}

          {/* Participant List */}
          <nav className="mb-8">
            <h2 className="text-xl font-semibold mb-2">Individual Reports</h2>
            <ul className="space-y-6">
              {statsList.map(s => (
                <li key={s.participantId}>
                  {s.error ? (
                    <div className="border p-4 rounded bg-red-100 text-red-700">
                      <strong>{s.participantId}</strong>: {s.error}
                    </div>
                  ) : (
                    <div className="border p-4 rounded">
                      <Link
                        href={`/report/${s.participantId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-medium hover:underline"
                      >
                        {s.participantId}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <div><strong>Total:</strong> {s.total}</div>
                        <div>
                          <strong>Accepted:</strong> {s.acceptedCount} ({s.acceptedPct.toFixed(1)}%)
                        </div>
                        <div>
                          <strong>Not Accepted:</strong> {s.notAcceptedCount} ({s.notAcceptedPct.toFixed(1)}%)
                        </div>
                        <div>
                          <strong>Dur(ms):</strong> avg {s.durationSummary.avg.toFixed(1)}, 
                          min {s.durationSummary.min}, max {s.durationSummary.max}
                        </div>
                        <div>
                          <strong>Dwell(ms):</strong> avg {s.dwellSummary.avg.toFixed(1)}, 
                          min {s.dwellSummary.min}, max {s.dwellSummary.max}
                        </div>
                      </div>

                      {/* ── Timeline Chart ─────────────────────────── */}
                      {s.fullMaxEnd > 0 && (
                        <div className="mt-4 h-12 w-full bg-gray-200 rounded relative overflow-hidden">
                          {s.filteredRegions.map((r, i) => (
                            <div
                              key={i}
                              className={`absolute top-0 h-full ${
                                r.accepted ? 'bg-green-500' : 'bg-red-500'
                              }`}
                              style={{
                                left:  `${(r.start    / s.fullMaxEnd) * 100}%`,
                                width: `${(r.duration / s.fullMaxEnd) * 100}%`,
                              }}
                            />
                          ))}
                        </div>
                      )}

                      {/* ── Acceptance Bar Chart ───────────────────────── */}
                      {s.total > 0 && (
                        <div className="mt-4 h-4 w-full bg-red-300 rounded overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${(s.acceptedCount / s.total) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </div>
  );
}
