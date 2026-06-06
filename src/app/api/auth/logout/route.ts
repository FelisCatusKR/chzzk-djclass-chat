import { NextRequest, NextResponse } from 'next/server'

export async function POST(_request: NextRequest) {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('session')
  return response
}
