# Release runbook — claude-switcher-account (`claudep`)

Quy trình phát hành: **kiểm tra → chọn mức nâng version → nhập mã 2FA → publish npm →
push GitHub**, với **npm và GitHub luôn cùng một số version**.

> Đây là runbook để người (hoặc Claude) làm theo. Muốn đổi quy tắc/thêm bước thì
> sửa thẳng file này — không phụ thuộc script cứng.

---

## 1. Quy tắc chọn version (SemVer `MAJOR.MINOR.PATCH`)

Nhìn thay đổi lần này thuộc loại nào rồi nâng đúng số:

| Loại thay đổi | Nâng số | Ví dụ |
|---|---|---|
| **Sửa lỗi / chỉnh nhỏ**, không đổi cách dùng | số **cuối** (PATCH) | `2.0.0 → 2.0.1` |
| **Thêm tính năng** mới, vẫn tương thích cũ | số **giữa** (MINOR) — reset PATCH về 0 | `2.0.1 → 2.1.0` |
| **Thay đổi lớn / phá vỡ tương thích** (đổi tên lệnh, bỏ flag, đổi hành vi) | số **đầu** (MAJOR) — reset hai số sau về 0 | `2.1.0 → 3.0.0` |

**Đồng bộ npm ↔ GitHub:** version trong `package.json`, tag git `vX.Y.Z`, và bản
trên npm **phải trùng nhau**. Dùng `npm version` để nó tự tạo commit + tag khớp,
rồi push tag lên GitHub.

---

## 2. Điều kiện trước khi release

- [ ] Đang ở đúng branch định phát hành, **working tree sạch** (`git status` không còn gì).
- [ ] Đã đăng nhập npm và là maintainer: `npm whoami` (phải ra tài khoản có quyền,
      hiện tại là `khainguyenhm`).
- [ ] `npm run typecheck` và `npm test` đều xanh.
- [ ] Có **mã 2FA** sẵn sàng (xem mục 4).

---

## 3. Các bước release

Thay `<type>` bằng `patch` | `minor` | `major` theo mục 1.

```bash
# 0) Sạch sẽ + đúng nhánh
git status                       # phải "clean"
npm whoami                       # phải ra tài khoản có quyền publish

# 1) Kiểm thử trước (fail sớm, tránh tạo tag lỗi)
npm run typecheck
npm test

# 2) Bump version — TỰ tạo commit "vX.Y.Z" và tag git khớp
npm version <type> -m "release: v%s"
#   patch → x.y.(z+1) | minor → x.(y+1).0 | major → (x+1).0.0

# 3) Publish lên npm (nhập mã 2FA vào --otp; xem mục 4)
#    prepublishOnly tự chạy typecheck+test, prepare tự build dist
npm publish --otp=<MÃ_2FA>

# 4) Push commit + tag để GitHub trùng version với npm
git push --follow-tags
```

Xong: kiểm tra lại
```bash
npm view claude-switcher-account version # == version vừa release
git tag --list 'v*' | tail -1            # == vX.Y.Z
```

---

## 4. Mã 2FA khi publish

Tài khoản npm **bật 2FA**, nên `npm publish` sẽ đòi mã. Chấp nhận:

- **OTP 6 số** từ app authenticator (nếu dùng TOTP), **hoặc**
- **Recovery code** — mỗi mã **dùng một lần** (tài khoản này đang dùng Security key
  nên không có OTP để gõ → dùng recovery code trong file
  `npm_recovery_codes*.txt`). Đặt vào `--otp`, KHÔNG đặt vào `_authToken`.

Cách bỏ qua 2FA khi publish từ CLI (đỡ phải nhập mã mỗi lần): tạo **Automation
token** ở npmjs.com → *Access Tokens → Generate → Classic → Automation* (chuỗi
`npm_...`), rồi:
```bash
NPM_CONFIG_TOKEN=... npm publish   # hoặc cấu hình _authToken trong ~/.npmrc
```

> ⚠️ Recovery code / token là chìa khóa vượt 2FA — đừng commit, đừng dán nơi công khai.
> Nếu lỡ lộ, vào npmjs.com **Regenerate recovery codes** / revoke token.

---

## 5. Khi có sự cố

| Tình huống | Xử lý |
|---|---|
| `EOTP` (đòi mã) | Nhập lại `--otp=<mã>`. Recovery code có thể đã bị dùng → lấy mã khác. |
| `E401` khi dùng token | Token sai/hết hạn/không phải npm token — token npm bắt đầu bằng `npm_`. |
| `E403 Forbidden` | Tài khoản không phải maintainer của package, hoặc version đã tồn tại. |
| Đã `npm version` nhưng publish fail | Commit + tag local đã tạo nhưng **chưa push**. Sửa lỗi rồi chạy lại `npm publish --otp=<mã>` và `git push --follow-tags`. Không bump lần nữa. |
| Muốn hủy bump chưa push | `git reset --hard HEAD~1 && git tag -d vX.Y.Z` |

**Không** publish đè lên một version đã tồn tại (npm không cho). Luôn bump số mới.

---

## 6. Checklist nhanh

```
[ ] git clean + đúng branch
[ ] npm whoami = tài khoản có quyền
[ ] typecheck + test xanh
[ ] chọn patch/minor/major đúng loại thay đổi
[ ] npm version <type> -m "release: v%s"
[ ] npm publish --otp=<mã 2FA>
[ ] git push --follow-tags
[ ] npm view ... version khớp tag git
```
