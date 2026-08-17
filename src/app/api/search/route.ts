import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

type SearchTopic = {
  Text?: string;
  FirstURL?: string;
  Topics?: SearchTopic[];
};

function flattenTopics(topics: SearchTopic[], result: Array<{ text: string; url: string }>) {
  for (const topic of topics) {
    if (topic.Text && topic.FirstURL) result.push({ text: topic.Text, url: topic.FirstURL });
    if (topic.Topics) flattenTopics(topic.Topics, result);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return NextResponse.json({ error: 'La búsqueda está vacía' }, { status: 400 });

    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return NextResponse.json({ context: '' });

    const data = await response.json();
    const results: Array<{ text: string; url: string }> = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({ text: data.AbstractText, url: data.AbstractURL });
    }
    flattenTopics(data.RelatedTopics ?? [], results);

    const context = results.slice(0, 8).map((item, index) => (
      `[Fuente ${index + 1}] ${item.text}\nURL: ${item.url}`
    )).join('\n\n');

    return NextResponse.json({ context });
  } catch (error) {
    console.error('Error en /api/search:', error);
    return NextResponse.json({ context: '' });
  }
}
