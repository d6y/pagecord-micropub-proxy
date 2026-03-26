export type ContentFormat = "markdown" | "html";
export type PostStatus = "published" | "draft";

export interface ParsedEntry {
  title?: string;
  content: string;
  contentFormat: ContentFormat;
  status: PostStatus;
  slug?: string;
  publishedAt?: string;
  tags: string[];
  photos: ParsedPhoto[];
}

export interface ParsedPhoto {
  /** A URL to fetch the image from (when sent as a URL property). */
  url?: string;
  /** A file blob (when sent as a multipart upload). */
  blob?: Blob;
  filename: string;
  alt?: string;
}

export interface PagecordAttachment {
  attachable_sgid: string;
  url: string;
}

export interface CreatePostParams {
  title?: string;
  content: string;
  content_format: ContentFormat;
  status: PostStatus;
  slug?: string;
  published_at?: string;
  /** Comma-separated tag list. */
  tags?: string;
}

export type PagecordClient = {
  createPost: (params: CreatePostParams) => Promise<string>;
  uploadAttachment: (blob: Blob, filename: string) => Promise<PagecordAttachment>;
};
