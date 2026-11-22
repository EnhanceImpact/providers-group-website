
(() => {
    const cfg = window.TPG_CONFIG || {};

    const configured = Boolean(
        cfg.supabaseUrl &&
        !cfg.supabaseUrl.includes('YOUR_PROJECT_REF') &&
        cfg.supabaseAnonKey &&
        !cfg.supabaseAnonKey.includes('YOUR_SUPABASE') &&
        window.supabase
    );

    const esc = s => String(s ?? '').replace(
        /[&<>"']/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c])
    );

    const sb = configured
        ? window.supabase.createClient(
            cfg.supabaseUrl,
            cfg.supabaseAnonKey
        )
        : null;

    function elapsedWeeks() {
        const start = new Date(
            (cfg.blogRotationStart || '2026-10-12') +
            'T00:00:00Z'
        );

        if (!Number.isFinite(start.getTime())) {
            return -1;
        }

        return Math.floor(
            (Date.now() - start.getTime()) /
            (7 * 24 * 60 * 60 * 1000)
        );
    }

    function rotationOrder() {
        const weeks = elapsedWeeks();
        return weeks < 0 ? 0 : (weeks % 60) + 1;
    }

    function releasedThrough() {
        return Math.min(60, Math.max(0, elapsedWeeks() + 1));
    }

    function fmt(d) {
        if (!d) return '';

        const date = new Date(d);
        if (!Number.isFinite(date.getTime())) return '';

        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC'
        }).format(date);
    }

    function safeBody(text) {
        return esc(text || '')
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    async function loadBlog() {
        const status = document.querySelector('#blog-status');
        if (!status) return;

        const box = document.querySelector('#featured-article');
        const grid = document.querySelector('#article-grid');
        const sel = document.querySelector('#blog-category');

        if (box) box.hidden = true;
        if (grid) grid.innerHTML = '';
        if (sel) sel.hidden = true;

        if (!configured) {
            status.textContent = 'Please check back shortly.';
            return;
        }

        if (releasedThrough() === 0) {
            status.textContent = 'New articles are coming soon.';
            return;
        }

        try {
            const { data, error } = await sb
                .from('blog_articles')
                .select(
                    'id,title,slug,excerpt,featured_image_url,' +
                    'category,author,rotation_order,original_publish_date'
                )
                .eq('status', 'approved')
                .gte('rotation_order', 1)
                .lte('rotation_order', releasedThrough())
                .order('rotation_order', { ascending: false });

            if (error) throw error;

            if (!data?.length) {
                status.textContent = 'New articles are coming soon.';
                return;
            }

            const order = rotationOrder();

            const featured =
                data.find(a => a.rotation_order === order) ||
                data[0];

            status.textContent = '';

            document.querySelector('#featured-title').textContent =
                featured.title;

            document.querySelector('#featured-excerpt').textContent =
                featured.excerpt || '';

            document.querySelector('#featured-meta').textContent =
                [featured.category, featured.author]
                    .filter(Boolean)
                    .join(' · ');

            document.querySelector('#featured-link').href =
                'article.html?slug=' +
                encodeURIComponent(featured.slug);

            const fi = document.querySelector('#featured-image');

            if (fi) {
                fi.hidden = true;

                if (featured.featured_image_url) {
                    fi.src = featured.featured_image_url;
                    fi.alt = 'Featured image for ' + featured.title;
                    fi.hidden = false;
                }
            }

            if (box) box.hidden = false;

            const cats = [
                ...new Set(
                    data.map(x => x.category).filter(Boolean)
                )
            ].sort();

            if (sel && grid) {
                cats.forEach(c => {
                    const o = document.createElement('option');
                    o.value = c;
                    o.textContent = c;
                    sel.appendChild(o);
                });

                sel.hidden = false;

                const render = () => {
                    const list = sel.value
                        ? data.filter(x => x.category === sel.value)
                        : data;

                    grid.innerHTML = list.map(a => `
                        <article class="card blog-card">
                            ${a.featured_image_url
                                ? `<img src="${esc(a.featured_image_url)}" alt="">`
                                : ''}
                            <span class="eyebrow">
                                ${esc(a.category || 'Give Life Journal')}
                            </span>
                            <h3>${esc(a.title)}</h3>
                            <p>${esc(a.excerpt || '')}</p>
                            <a href="article.html?slug=${encodeURIComponent(a.slug)}">
                                Read article →
                            </a>
                        </article>
                    `).join('');
                };

                sel.addEventListener('change', render);
                render();
            }

        } catch (error) {
            console.error('Blog loading failed:', error);

            if (box) box.hidden = true;
            if (grid) grid.innerHTML = '';
            if (sel) sel.hidden = true;

            status.textContent = 'Please check back shortly.';
        }
    }

    async function loadArticle() {
        const wrap = document.querySelector('#article-content');
        if (!wrap) return;

        const status = document.querySelector('#article-status');
        wrap.hidden = true;

        if (!configured) {
            status.textContent =
                'This article is temporarily unavailable.';
            return;
        }

        const slug = new URLSearchParams(location.search).get('slug');

        if (!slug || releasedThrough() === 0) {
            status.textContent = 'Article not found.';
            return;
        }

        try {
            const { data, error } = await sb
                .from('blog_articles')
                .select(
                    'title,slug,category,author,excerpt,content,' +
                    'original_publish_date,featured_image_url'
                )
                .eq('slug', slug)
                .eq('status', 'approved')
                .gte('rotation_order', 1)
                .lte('rotation_order', releasedThrough())
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                status.textContent = 'Article not found.';
                return;
            }

            status.textContent = '';

            document.querySelector('#article-category').textContent =
                data.category || 'Give Life Journal';

            document.querySelector('#article-title').textContent =
                data.title;

            document.querySelector('#article-meta').textContent =
                [data.author, fmt(data.original_publish_date)]
                    .filter(Boolean)
                    .join(' · ');

            document.querySelector('#article-excerpt').textContent =
                data.excerpt || '';

            document.querySelector('#article-body').innerHTML =
                safeBody(data.content);

            const img = document.querySelector('#article-image');

            if (img) {
                img.hidden = true;

                if (data.featured_image_url) {
                    img.src = data.featured_image_url;
                    img.alt = 'Featured image for ' + data.title;
                    img.hidden = false;
                }
            }

            document.title =
                data.title + ' | The Providers Group';

            wrap.hidden = false;

        } catch (error) {
            console.error('Article loading failed:', error);
            status.textContent =
                'This article is temporarily unavailable.';
        }
    }

    loadBlog();
    loadArticle();
})();
