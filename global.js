// Quick check that this script is loading on every page
console.log('IT’S ALIVE!');

// Helper: like querySelectorAll, but returns a real array
// so we can use array methods (find, map, filter, etc.) on it
function $$(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

// List of every page on the site: where it lives and what the link text says.
// Internal pages use paths relative to the site root; external links use full URLs.
let pages = [
  { url: '', title: 'Home' },
  { url: 'projects/', title: 'Projects' },
  { url: 'meta/', title: 'Meta' },        // ← add this
  { url: 'contact/', title: 'Contact' },
  { url: 'resume/', title: 'Resume' },
  { url: 'https://github.com/justinjames1793', title: 'GitHub' },
];

// Where the site's root is, depending on where it's running:
// - Locally (Live Server), the site sits at the server root → "/"
// - On GitHub Pages, it lives under the repo name → "/DSC106-web-practice/"
const BASE_PATH = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/"                               // Local server
  : "/DSC106-web-practice/";  // GitHub Pages repo name

// Create an empty <nav> and put it at the very top of <body>
let nav = document.createElement('nav');
document.body.prepend(nav);

// Add one link to the nav for each page in the list
for (let p of pages) {
  let url = p.url;
  let title = p.title;

  // Internal links (not starting with "http") get the base path in front,
  // so they work from any page, locally and on GitHub Pages.
  // External links (like GitHub) are left as-is.
  url = !url.startsWith('http') ? BASE_PATH + url : url;

  // Create the <a> element and set its link and text
  let a = document.createElement('a');
  a.href = url;
  a.textContent = title;

  // Highlight the link to the page we're currently on
  // (same host and same path = same page)
  a.classList.toggle(
    'current',
    a.host === location.host && a.pathname === location.pathname,
  );

  // External links (different host, e.g. github.com) open in a new tab
  if (a.host !== location.host) {
    a.target = '_blank';
  }

  // Add the finished link to the end of the nav
  nav.append(a);
}

// Dark mode switch ---

// Is the OS currently in dark mode? Used to label the "Automatic" option.
let osIsDark = matchMedia('(prefers-color-scheme: dark)').matches;

// Add the theme dropdown to the top of every page.
// Each option's value is exactly what we'll set color-scheme to.
document.body.insertAdjacentHTML(
  'afterbegin',
  `
  <label class="color-scheme">
    Theme:
    <select>
      <option value="light dark">Automatic (${osIsDark ? 'Dark' : 'Light'})</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>`,
);

// Grab the dropdown so we can listen to it and update it
let select = document.querySelector('.color-scheme select');

// Apply a color scheme to the page and keep the dropdown in sync
function setColorScheme(colorScheme) {
  // Set color-scheme on <html>, which the CSS uses to pick light/dark
  document.documentElement.style.setProperty('color-scheme', colorScheme);
  // Make the dropdown show the matching option
  select.value = colorScheme;
}

// On page load: if the user picked a theme before, re-apply it
if ('colorScheme' in localStorage) {
  setColorScheme(localStorage.colorScheme);
}

// When the user changes the dropdown: apply it and remember it
select.addEventListener('input', function (event) {
  console.log('color scheme changed to', event.target.value);
  setColorScheme(event.target.value);
  localStorage.colorScheme = event.target.value;   // persists across reloads
});

// contact form ---

// Only the contact page has a form; on other pages this is null
let form = document.querySelector('form');
// Save draft: restore any saved field values, and save them as the user types
if (form) {
  for (let field of form.elements) {
    // Skip things without a name (like the submit button)
    if (!field.name) continue;

    // Use a key like "draft-subject" so it doesn't clash with colorScheme
    let key = 'draft-' + field.name;

    // On page load: put back whatever was saved
    if (key in localStorage) {
      field.value = localStorage[key];
    }

    // Every keystroke: save the current value
    field.addEventListener('input', function () {
      localStorage[key] = field.value;
    });
  }
}

// ?. skips this entirely on pages without a form, so no errors
form?.addEventListener('submit', function (event) {
  // Stop the browser's default submit (which encodes spaces as +)
  event.preventDefault();

  // Collect all the form's fields as [name, value] pairs
  let data = new FormData(form);

  // Start with the mailto: address from the form's action
  let url = form.action + '?';

  // Add each field as name=value, joined with &
  // encodeURIComponent turns spaces into %20 (and escapes other special characters)
  let params = [];
  for (let [name, value] of data) {
    params.push(`${name}=${encodeURIComponent(value)}`);
  }
  url += params.join('&');
    // Message is being sent, so clear the saved draft
  for (let [name] of data) {
    localStorage.removeItem('draft-' + name);
  }

  // Opening a mailto: URL launches the email client with the fields prefilled
  location.href = url;
});

// Projects ---

// Load a JSON file and return the parsed data
export async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    console.log(response); // check it in DevTools; delete this line once it works

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching or parsing JSON data:', error);
  }
}

// Render an array of projects into a container element
export function renderProjects(projects, containerElement, headingLevel = 'h2') {
  // Guard: no container means nothing to render into
  if (!containerElement) {
    console.error('renderProjects: containerElement is missing');
    return;
  }

  // Guard: only allow real heading tags, otherwise fall back to h2
  if (!/^h[1-6]$/.test(headingLevel)) {
    headingLevel = 'h2';
  }

  // Clear old content so projects don't get duplicated
  containerElement.innerHTML = '';

  // Empty or missing data: show a placeholder message
  if (!projects || projects.length === 0) {
    containerElement.innerHTML = '<p>No projects to show yet.</p>';
    return;
  }

  for (let project of projects) {
    const article = document.createElement('article');
        article.innerHTML = `
      <${headingLevel}>${project.title}</${headingLevel}>
      <img src="${project.image}" alt="${project.title}">
      <div>
        <p>${project.description}</p>
        <p class="project-year">c. ${project.year}</p>
      </div>
    `;
    containerElement.appendChild(article);
  }
}

// Get public profile data for a GitHub user
export async function fetchGitHubData(username) {
  return fetchJSON(`https://api.github.com/users/${username}`);
}