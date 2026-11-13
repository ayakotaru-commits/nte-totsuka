"""HTTP Range リクエストで巨大 ZIP から必要なファイルだけ取り出す。"""
import io
import urllib.request
import zipfile

UA = {"User-Agent": "personal-city-viewer/0.1"}


class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        req = urllib.request.Request(url, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self._cache = {}  # (start) -> bytes, 末尾読み用の簡易キャッシュ

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={**UA, "Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def open_remote_zip(url):
    # 中央ディレクトリをまとめて読むためにバッファリング
    return zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=4 * 1024 * 1024))
