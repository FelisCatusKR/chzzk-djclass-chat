import { describe, it, expect } from 'vitest'
import { parseEmojiContent } from '../src/lib/emoji'

const MAP = {
  d_07: 'https://cdn.example/d_07.png',
  cat: 'https://cdn.example/cat.png',
}

describe('parseEmojiContent', () => {
  it('returns a single text part when there are no placeholders', () => {
    expect(parseEmojiContent('hello world', MAP)).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('resolves a single placeholder to an emoji part', () => {
    expect(parseEmojiContent('hi {:cat:}', MAP)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
    ])
  })

  it('resolves multiple placeholders interleaved with text', () => {
    expect(parseEmojiContent('a {:cat:} b {:d_07:} c', MAP)).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'text', value: ' b ' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
      { type: 'text', value: ' c' },
    ])
  })

  it('handles adjacent placeholders with no text between', () => {
    expect(parseEmojiContent('{:cat:}{:d_07:}', MAP)).toEqual([
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
    ])
  })

  it('handles a placeholder at the start and at the end', () => {
    expect(parseEmojiContent('{:cat:} mid {:d_07:}', MAP)).toEqual([
      { type: 'emoji', key: 'cat', url: 'https://cdn.example/cat.png' },
      { type: 'text', value: ' mid ' },
      { type: 'emoji', key: 'd_07', url: 'https://cdn.example/d_07.png' },
    ])
  })

  it('drops a placeholder whose key is not in the map', () => {
    expect(parseEmojiContent('hi {:nope:} there', MAP)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'text', value: ' there' },
    ])
  })

  it('drops all placeholders when the map is empty, keeping text', () => {
    expect(parseEmojiContent('hi {:cat:} there', {})).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'text', value: ' there' },
    ])
  })
})
