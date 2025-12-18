import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'GET', path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'POST', path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'PUT', path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'DELETE', path);
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const targetUrl = `${BACKEND_URL}/${path.join('/')}${searchParams ? `?${searchParams}` : ''}`;

    console.log(`Proxying ${method} request to:`, targetUrl);

    const headers: HeadersInit = {
      ...(request.headers.get('accept') ? { Accept: request.headers.get('accept') as string } : {}),
    };

    const incomingContentType = request.headers.get('content-type');
    if (incomingContentType) headers['Content-Type'] = incomingContentType;

    // Prefer per-user Authorization header passed from the browser; fallback to server env API_KEY for local/dev.
    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) {
      headers['Authorization'] = incomingAuth;
    } else if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const body = method !== 'GET' && method !== 'DELETE' 
      ? await request.text() 
      : undefined;

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const contentType = response.headers.get('content-type') || 'application/json';

    if (contentType.includes('text/event-stream') && response.body) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': response.headers.get('cache-control') || 'no-cache',
        },
      });
    }

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
