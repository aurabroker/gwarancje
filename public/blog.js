const SB_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY';

const TABLE    = 'aura_articles';
const PLATFORM = 'Gwarancje.pro';

const supabase = window.supabase.createClient(SB_URL, SB_KEY);

let currentArticle = null;

document.addEventListener('DOMContentLoaded', () => {
  loadArticles();
  bindCloseArticle();
  bindCopyLink();
  handleHashOnLoad();
});

window.addEventListener('hashchange', handleHashOnLoad);

async function loadArticles() {
  const grid  = document.getElementById('blog-grid');
  const errEl = document.getElementById('blog-error');

  try {
    const { data: posts, error } = await supabase
      .from(TABLE)
      .select('id, title, excerpt, tags, published_at, created_at, thumbnail_url')
      .eq('status', 'published')
      .contains('platforms', [PLATFORM])
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!posts || posts.length === 0) {
      grid.innerHTML = '<div class="col-span-full py-20 text-center text-slate-400 font-medium">Brak opublikowanych artykułów.</div>';
      return;
    }

    grid.innerHTML = posts.map(renderCard).join('');
  } catch (err) {
    console.error('[Blog] Błąd ładowania artykułów:', err);
    grid.innerHTML = '';
    if (errEl) errEl.classList.remove('hidden');
  }
}

function renderCard(post) {
  const date    = formatDate(post.published_at || post.created_at);
  const tags    = (post.tags || []).slice(0, 3);
  const excerpt = post.excerpt ? escapeHtml(post.excerpt).slice(0, 140) + '…' : '';
  const cover   = post.thumbnail_url
    ? `<img src="${escapeHtml(post.thumbnail_url)}" alt="${escapeHtml(post.title)}" class="w-full h-48 object-cover">`
    : `<div class="w-full h-48 flex items-center justify-center text-5xl" style="background:#e8f2f0">📄</div>`;

  const tagsHtml = tags.map(t =>
    `<span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background:#cedcd8;color:#01696f">${escapeHtml(t)}</span>`
  ).join('');

  return `
    <article class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col"
             onclick="openArticle('${post.id}')">
      <div class="overflow-hidden">${cover}</div>
      <div class="p-6 flex flex-col flex-1">
        ${tagsHtml ? `<div class="flex flex-wrap gap-1.5 mb-3">${tagsHtml}</div>` : ''}
        <h2 class="text-lg font-bold text-slate-900 leading-snug mb-2 flex-1">${escapeHtml(post.title)}</h2>
        ${excerpt ? `<p class="text-sm text-slate-500 leading-relaxed mb-4">${excerpt}</p>` : ''}
        <div class="flex items-center justify-between mt-auto pt-4 border-t border-slate-100">
          <span class="text-xs text-slate-400">${date}</span>
          <span class="text-xs font-semibold" style="color:#01696f">Czytaj →</span>
        </div>
      </div>
    </article>`;
}

async function openArticle(id) {
  window.location.hash = id;

  const listView   = document.getElementById('blog-list-view');
  const readerView = document.getElementById('article-reader-view');

  readerView.classList.remove('hidden');
  listView.classList.add('hidden');
  readerView.scrollTop = 0;

  document.getElementById('reader-title').textContent = 'Ładowanie…';
  document.getElementById('reader-content').innerHTML = '';
  document.getElementById('reader-date').textContent  = '';
  document.getElementById('reader-tags').innerHTML    = '';

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    currentArticle = data;
    renderArticle(data);
  } catch (err) {
    console.error('[Blog] Błąd ładowania artykułu:', err);
    document.getElementById('reader-title').textContent = 'Nie znaleziono artykułu';
    document.getElementById('reader-content').innerHTML = '<p class="text-slate-400">Artykuł jest niedostępny lub nie istnieje.</p>';
  }
}

function renderArticle(post) {
  const tags = (post.tags || []);

  document.getElementById('reader-title').textContent = post.title;
  document.getElementById('reader-date').textContent  = formatDate(post.published_at || post.created_at);
  document.getElementById('reader-content').innerHTML = post.content || '';

  const tagsEl = document.getElementById('reader-tags');
  tagsEl.innerHTML = tags.map(t =>
    `<span class="text-xs font-bold px-3 py-1 rounded-full" style="background:#cedcd8;color:#01696f">${escapeHtml(t)}</span>`
  ).join('');
}

function bindCloseArticle() {
  document.getElementById('close-article-btn').addEventListener('click', closeArticle);
}

function closeArticle() {
  document.getElementById('article-reader-view').classList.add('hidden');
  document.getElementById('blog-list-view').classList.remove('hidden');
  history.pushState(null, '', window.location.pathname);
  currentArticle = null;
}

function bindCopyLink() {
  const btn = document.getElementById('copy-link-btn');
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Skopiowano!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
  });
}

function handleHashOnLoad() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    openArticle(hash);
  } else {
    document.getElementById('article-reader-view').classList.add('hidden');
    document.getElementById('blog-list-view').classList.remove('hidden');
  }
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
