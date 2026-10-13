(function () {
  const BASE_SOURCE_PATTERNS = {
    'Critical': [
      /location\.hash/, /location\.search/, /location\.href/, /\blocation\b(?!\.)/,
      /location\.pathname/, /document\.URL/, /document\.documentURI/,
      /URLSearchParams\s*\(/
    ],
    'High': [
      /document\.referrer/, /window\.name/, /\bevent\.data\b/,
      /addEventListener\s*\(\s*["']message["']/
    ],
    'Medium': [
      /localStorage\.getItem/, /sessionStorage\.getItem/, /document\.cookie/,
      /window\.__INITIAL_STATE__/, /window\.__NEXT_DATA__/, /window\.__NUXT__/,
      /history\.state/
    ],
    'Low': [
      /navigator\.userAgent/, /navigator\.language/, /document\.title/,
      /FileReader\s*\(/, /clipboardData\.getData/, /navigator\.clipboard\.readText/,
      /indexedDB/, /\bcaches\b/
    ]
  };

  function buildPatterns(mode) {
    const patterns = {};
    patterns['Critical'] = [...BASE_SOURCE_PATTERNS['Critical']];
    patterns['High'] = [...BASE_SOURCE_PATTERNS['High']];
    if (mode === 'full') {
      patterns['Medium'] = [...BASE_SOURCE_PATTERNS['Medium']];
      patterns['Low'] = [...BASE_SOURCE_PATTERNS['Low']];
    }
    return patterns;
  }

  function scanText(text, sourceName, patterns, findings, seen) {
    for (const [category, list] of Object.entries(patterns)) {
      for (const re of list) {
        const regex = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = regex.exec(text)) !== null) {
          const start = Math.max(0, m.index - 40);
          const end = Math.min(text.length, m.index + m[0].length + 40);
          const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
          const key = category + '|' + m[0] + '|' + sourceName;
          if (seen.has(key)) continue;
          seen.add(key);
          (findings[category] = findings[category] || []).push({
            match: m[0], snippet, source: sourceName
          });
          if (regex.lastIndex === m.index) regex.lastIndex++;
        }
      }
    }
  }

  window.sourceScan = async function (mode = 'strict', categories = null) {
    const patterns = buildPatterns(mode);

    let filtered = patterns;
    if (categories) {
      const list = Array.isArray(categories) ? categories : [categories];
      filtered = {};
      for (const cat of list) {
        if (!patterns[cat]) {
          console.warn('Unknown category:', cat, '| Valid:', Object.keys(patterns));
          continue;
        }
        filtered[cat] = patterns[cat];
      }
      if (Object.keys(filtered).length === 0) return;
    }

    const findings = {};
    const seen = new Set();

    scanText(document.documentElement.outerHTML, 'HTML', filtered, findings, seen);

    document.querySelectorAll('script:not([src])').forEach((el, i) => {
      scanText(el.textContent || '', 'inline-script-' + i, filtered, findings, seen);
    });

    const externalScripts = [...document.querySelectorAll('script[src]')]
      .map(s => s.src)
      .filter((v, i, a) => a.indexOf(v) === i);

    await Promise.all(externalScripts.map(async (src) => {
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const text = await res.text();
        scanText(text, src, filtered, findings, seen);
      } catch (e) {
        // CORS یا خطای شبکه - نادیده گرفته میشه
      }
    }));

    window.__sourceFindings = findings;

    console.log(`%cSource Scan Results (mode: ${mode}${categories ? ', categories: ' + (Array.isArray(categories) ? categories.join(', ') : categories) : ''})`, 'font-weight:bold;font-size:14px');
    for (const [cat, items] of Object.entries(findings)) {
      console.groupCollapsed(`${cat} (${items.length})`);
      console.table(items);
      console.groupEnd();
    }
    if (Object.keys(findings).length === 0) console.log('No sources found.');

    console.log('%cFor copy: copy(window.__sourceFindings)  |  For download: downloadSourceFindings()', 'color:gray;font-style:italic');

    return findings;
  };

  window.downloadSourceFindings = function (filename) {
    if (!window.__sourceFindings || Object.keys(window.__sourceFindings).length === 0) {
      console.warn('No findings yet. Run sourceScan() first.');
      return;
    }
    const json = JSON.stringify(window.__sourceFindings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `source-scan-${location.hostname}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log('Downloaded:', a.download);
  };
})();
