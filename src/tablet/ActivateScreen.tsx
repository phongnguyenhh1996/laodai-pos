// Bước 2 sẽ hoàn thiện: đăng nhập chủ → chọn hồ sơ tablet → gọi Edge Function activate-tablet.
export function ActivateScreen() {
  return (
    <main data-testid="activate-screen" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Kích hoạt tablet</h1>
      <p className="text-lg text-stone-600">Chủ đăng nhập một lần để gắn máy này với một hồ sơ tablet.</p>
    </main>
  );
}
