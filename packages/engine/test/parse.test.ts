import { describe, it, expect } from 'vitest';
import { parseDocument } from '../src/parse';

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('parseDocument', () => {
  it('parses HTML to markdown', async () => {
    const r = await parseDocument(
      enc('<html><body><main><h1>Hi</h1><p>Body text here.</p></main></body></html>'),
      'text/html',
      'https://e.com',
    );
    expect(r.markdown).toContain('# Hi');
    expect(r.markdown).toContain('Body text');
    expect(r.metadata.contentType).toBe('text/html');
  });

  it('passes plain text through', async () => {
    const r = await parseDocument(enc('just some text'), 'text/plain');
    expect(r.markdown).toBe('just some text');
  });

  it('detects HTML even with an empty content-type', async () => {
    const r = await parseDocument(enc('<!doctype html><html><body><p>Yo</p></body></html>'), '');
    expect(r.markdown).toContain('Yo');
  });

  it('converts CSV into a GFM Markdown table', async () => {
    const r = await parseDocument(
      enc('Name,Plan,Credits\nAlice,Hobby,5000\nBob,Standard,100000'),
      'text/csv',
      'plans.csv',
    );
    expect(r.markdown).toContain('| Name | Plan | Credits |');
    expect(r.markdown).toContain('| Alice | Hobby | 5000 |');
    expect(r.metadata.format).toBe('csv');
  });

  it('parses DOCX / Office XML streams and RTF documents', async () => {
    const docxXml = enc(
      '<w:document><w:body><w:p><w:r><w:t>Hello from DOCX XML</w:t></w:r></w:p></w:body></w:document>',
    );
    const rDocx = await parseDocument(
      docxXml,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'report.docx',
    );
    expect(rDocx.markdown).toContain('Hello from DOCX XML');
    expect(rDocx.metadata.format).toBe('docx');

    const rRtf = await parseDocument(
      enc('{\\rtf1\\ansi Hello RTF World\\par Second paragraph}'),
      'application/rtf',
      'note.rtf',
    );
    expect(rRtf.markdown).toContain('Hello RTF World');
    expect(rRtf.metadata.format).toBe('rtf');
  });

  it('throws an explicit error on unsupported binary types like video/mp4', async () => {
    await expect(parseDocument(enc('x'), 'video/mp4')).rejects.toThrow(/Unsupported/);
  });
});
