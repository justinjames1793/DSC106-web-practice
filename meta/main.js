import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Load loc.csv and convert each row's strings into proper numbers and dates
async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line), // or just +row.line
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

// Group the per-line rows by commit and build one summary object per commit
function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit) // -> [[commitId, [line, line, ...]], ...]
    .map(([commit, lines]) => {
      // Every line in a commit shares the same author/date/time, so read them off the first one
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;

      let ret = {
        id: commit,
        url: 'https://github.com/justinjames1793/DSC106_Lab_1/commit/' + commit,
        author,
        date,
        time,
        timezone,
        datetime,
        // Time of day as a decimal, e.g. 2:30 PM -> 14.5
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        // Number of lines this commit touched
        totalLines: lines.length,
      };

      // Keep the original line rows on the commit, but hidden:
      // enumerable: false keeps it out of console.log and loops,
      // while ret.lines still works when we need it later
      Object.defineProperty(ret, 'lines', {
        value: lines,
        enumerable: false,
        writable: false,
        configurable: false,
      });

      return ret;
    });
}

// Scales live at the top level (not inside renderScatterPlot) so the brush
// functions below can use them too. renderScatterPlot assigns them.
let xScale;
let yScale;

// Show summary stats about the codebase as a <dl> in #stats
function renderCommitInfo(data, commits) {
  const dl = d3.select('#stats').append('dl').attr('class', 'stats');

  // Total lines of code (one row per line)
  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  // Total commits
  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  // Number of distinct values: how many different files there are
  const numFiles = d3.group(data, (d) => d.file).size;
  dl.append('dt').text('Files');
  dl.append('dd').text(numFiles);

  // Grouped aggregate: length of each file (its highest line number), then the average
  const fileLengths = d3.rollups(
    data,
    (v) => d3.max(v, (d) => d.line),
    (d) => d.file,
  );
  const averageFileLength = d3.mean(fileLengths, (d) => d[1]);
  dl.append('dt').text('Avg file length');
  dl.append('dd').text(Math.round(averageFileLength));

  // Aggregate over the whole dataset: deepest indentation level
  const maxDepth = d3.max(data, (d) => d.depth);
  dl.append('dt').text('Max depth');
  dl.append('dd').text(maxDepth);

  // Min/max value: the time of day with the most lines written
  const workByPeriod = d3.rollups(
    data,
    (v) => v.length,
    (d) => d.datetime.toLocaleString('en', { dayPeriod: 'short' }),
  );
  const maxPeriod = d3.greatest(workByPeriod, (d) => d[1])?.[0];
  dl.append('dt').text('Most work done');
  dl.append('dd').text(maxPeriod);
}

// Fill the tooltip <dl> with info about one commit
function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-time');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (Object.keys(commit).length === 0) return; // nothing to show

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', { dateStyle: 'full' });
  time.textContent = commit.datetime?.toLocaleString('en', { timeStyle: 'short' });
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

// Show or hide the tooltip via the HTML `hidden` attribute (CSS fades it in/out)
function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

// Move the tooltip next to the mouse (clientX/Y are viewport coords, matching position: fixed)
function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  const offset = 12; // nudge it off the cursor so it doesn't sit on top of the dot
  tooltip.style.left = `${event.clientX + offset}px`;
  tooltip.style.top = `${event.clientY + offset}px`;
}

// Let the user drag a rectangle over the chart to select dots
// Runs on every brush event (start, while dragging, end):
// mark each dot as selected or not based on the current rectangle
function brushed(event) {
  const selection = event.selection; // [[x0, y0], [x1, y1]] in SVG pixels, or null if cleared
  d3.select('#chart')
    .selectAll('circle')
    .classed('selected', (d) => isCommitSelected(selection, d));

  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

// Show how many commits are inside the brush; returns them for later use
function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? commits.filter((d) => isCommitSelected(selection, d))
    : [];

  const n = selectedCommits.length;
  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${n || 'No'} commit${n === 1 ? '' : 's'} selected`;

  return selectedCommits;
}

// For the selected commits, show lines and % of lines per language (css, html, js, ...)
function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? commits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  // Nothing selected -> clear the breakdown
  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Each commit's hidden .lines property holds its original line rows; flatten them into one list
  const lines = selectedCommits.flatMap((d) => d.lines);

  // Count lines per language: Map { 'css' => 120, 'js' => 80, ... }
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  // Rebuild the <dl>: one label/value pair per language
  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion); // e.g. 0.4567 -> "45.7%", 0.5 -> "50%"

    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

// Is this commit's dot inside the brush rectangle?
function isCommitSelected(selection, commit) {
  if (!selection) {
    return false; // no brush -> nothing selected
  }

  // Rectangle corners: [[x0, y0], [x1, y1]] -> separate x and y bounds
  const [x0, x1] = selection.map((d) => d[0]);
  const [y0, y1] = selection.map((d) => d[1]);

  // Where this commit's dot is drawn, using the same scales as the chart
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);

  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function createBrushSelector(svg) {
  // Create brush (adds an invisible .overlay rect on top of the chart to catch drags)
  // and call brushed() whenever it starts, moves, or ends
  svg.call(
    d3
      .brush()
      // Only start a brush from empty chart space, not from a dot.
      // (A drag that starts on a dot crashes inside d3-brush, because the dot
      // is a data-bound element the brush doesn't recognize.)
      .filter((event) => !event.ctrlKey && !event.button && !event.target.closest('.dots'))
      .on('start brush end', brushed),
  );

  // Raise dots and everything after overlay.
  // SVG paints in source order, so moving the dots after the overlay puts them back on top
  // and they get hover events again. `.overlay ~ *` also brings the brush's selection
  // rectangle and handles along, so they stay above the overlay too.
  svg.selectAll('.dots, .overlay ~ *').raise();
}

// Scatterplot: one dot per commit, date on X, time of day on Y
function renderScatterPlot(data, commits) {
  const width = 1000;
  const height = 600;

  // viewBox makes the SVG scale to fit its container
  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  // X: dates -> horizontal position (time scale understands Date objects)
  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime)) // [earliest, latest]
    .range([0, width])
    .nice(); // round the ends out to tidy dates

  // Y: hour of day (0-24) -> vertical position; range is flipped so midnight is at the bottom
  yScale = d3.scaleLinear().domain([0, 24]).range([height, 0]);

  // Leave room around the plot for the axes and their labels
  const margin = { top: 10, right: 10, bottom: 30, left: 20 };

  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  // Shrink the scales' ranges to the usable area.
  // This has to happen BEFORE the dots are drawn, or they'd use the old full-size ranges.
  xScale.range([usableArea.left, usableArea.right]);
  yScale.range([usableArea.bottom, usableArea.top]);

  // Gridlines: an axis with no labels and ticks stretched across the whole plot.
  // Drawn BEFORE the dots and axes so they sit underneath everything.
  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  gridlines.call(d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width));

  // Color each line by time of day: deep blue at midnight, orange at noon
  const daylight = (hour) => 1 - Math.abs(hour - 12) / 12; // 0 at midnight, 1 at noon
  gridlines
    .selectAll('.tick line')
    .attr('stroke', (d) => d3.interpolateRgb('midnightblue', 'orange')(daylight(d)));

  // Dot size: map lines edited per commit -> radius in px.
  // Square-root scale, because we perceive a circle's AREA (which grows with r²):
  // with sqrt, area is proportional to lines edited, so 2x the edits looks 2x as big, not 4x.
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rScale = d3
    .scaleSqrt()
    .domain([minLines, maxLines])
    .range([2, 30]);

  // Draw big commits first so small ones end up on top and stay hoverable
  // (SVG paints in document order; the minus sign makes the sort descending)
  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);

  // One <circle> per commit
  const dots = svg.append('g').attr('class', 'dots');

  dots
    .selectAll('circle')
    .data(sortedCommits)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7) // see-through so overlapping dots stay visible
    .on('mouseenter', (event, commit) => {
      // event.currentTarget is the <circle> being hovered; make it solid
      d3.select(event.currentTarget).style('fill-opacity', 1);
      // D3 passes the hovered dot's bound data (its commit) as the 2nd argument
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    })
    .on('mousedown', (event) => {
      // Dots sit above the brush overlay (so tooltips work), which means a drag that
      // starts on a dot never reaches the brush. Hand the press to the overlay instead,
      // so brushing works no matter where you start dragging.
      svg.select('.overlay').node().dispatchEvent(new MouseEvent('mousedown', event));
    });

  // Axes: d3.axisBottom/axisLeft build ticks + labels from a scale
  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3
    .axisLeft(yScale)
    // 0 -> "00:00", 14 -> "14:00", 24 -> "00:00" (% 24 turns 24 into 0)
    .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

  // X axis sits along the bottom edge of the usable area
  svg
    .append('g')
    .attr('transform', `translate(0, ${usableArea.bottom})`)
    .call(xAxis);

  // Y axis sits along the left edge of the usable area
  svg
    .append('g')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .call(yAxis);

  // Add the brush last, once the chart exists. It's called here because `svg`
  // only exists inside this function.
  createBrushSelector(svg);
}

let data = await loadData();
let commits = processCommits(data);

renderCommitInfo(data, commits);
renderScatterPlot(data, commits);
