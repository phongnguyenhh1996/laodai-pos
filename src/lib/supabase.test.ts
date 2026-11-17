// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY, decodeClaims, storedClaims } from './supabase';
import { fakeJwt, storeSession } from '@/test-utils/auth';

afterEach(() => localStorage.clear());

describe('decodeClaims', () => {
  it('đọc vai trò, hồ sơ tablet và email (kể cả ký tự tiếng Việt)', () => {
    expect(decodeClaims(fakeJwt({ role: 'tablet', tablet_profile_id: 'p1' }))).toEqual({
      role: 'tablet',
      tablet_profile_id: 'p1',
      email: null,
    });
    expect(decodeClaims(fakeJwt({ role: 'owner', email: 'chủ@quán.vn' }))).toMatchObject({ role: 'owner', email: 'chủ@quán.vn' });
  });

  it('token hỏng ⇒ null', () => {
    expect(decodeClaims('abc')).toBeNull();
    expect(decodeClaims('a.!!!.c')).toBeNull();
  });
});

describe('storedClaims', () => {
  it('không có phiên ⇒ null', () => {
    expect(storedClaims()).toBeNull();
  });

  it('đọc phiên đã lưu, kể cả token đã hết hạn (offline)', () => {
    storeSession({ role: 'tablet', tablet_profile_id: 'p1', exp: 1 });
    expect(storedClaims()).toMatchObject({ role: 'tablet', tablet_profile_id: 'p1' });
  });

  it('dữ liệu rác ⇒ null', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{oops');
    expect(storedClaims()).toBeNull();
    localStorage.setItem(AUTH_STORAGE_KEY, '{}');
    expect(storedClaims()).toBeNull();
  });
});
