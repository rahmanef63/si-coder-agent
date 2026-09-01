// user-facing.js — non-technical presentation layer for SI-Coder.
// Internal route/provider details stay available for agents and diagnostics, while this helper
// turns them into outcome-oriented language for people who should not need DevOps vocabulary.

const FRIENDLY_PROVIDER = Object.freeze({
  github: 'penyimpanan kode',
  vercel: 'hosting',
  convex: 'data aplikasi',
  'convex-cloud': 'data aplikasi',
  hostinger: 'domain',
  dokploy: 'server',
  resend: 'email',
  composio: 'connected accounts',
});

function friendlyProvider(id) { return FRIENDLY_PROVIDER[id] || id; }

function userPlanForDeploy(plan) {
  const hosted = plan.runtime === 'hosted';
  const waiting = plan.route === 'decision-required';
  const blocked = plan.ready === false;

  if (waiting) {
    return {
      title: 'Satu pilihan sebelum saya lanjut',
      outcome: 'Saya akan memilih cara termudah untuk membuat aplikasi online.',
      status: 'needs-answer',
      question: 'Kamu sudah punya server/VPS sendiri untuk dipakai, atau ingin saya gunakan hosting terkelola?',
      choices: [
        { id: 'vps', label: 'Saya punya server sendiri' },
        { id: 'managed', label: 'Gunakan yang paling mudah' },
      ],
      technicalDetailsOptional: true,
    };
  }

  const base = {
    title: 'Siap membuat web app online',
    outcome: 'SI-Coder akan mengurus publikasi aplikasi, alamat domain, dan pengecekan akhir.',
    status: blocked ? 'needs-action' : 'ready',
    steps: [
      'Siapkan versi aplikasi yang akan dipublikasikan',
      'Hubungkan akun yang dibutuhkan dengan aman',
      'Publikasikan aplikasi',
      'Pasang domain pilihanmu',
      'Pastikan website aman dan semua fungsi utama bekerja',
    ],
    technicalDetailsOptional: true,
  };

  if (hosted) {
    base.connectionMessage = 'Tidak perlu menyiapkan server atau terminal. Saya akan menggunakan koneksi akun yang aman.';
    base.accounts = ['penyimpanan kode', 'data aplikasi', 'hosting', 'domain'];
  } else if (plan.route === 'vps') {
    base.connectionMessage = 'Saya akan memakai server milikmu dan mengurus konfigurasi teknis di belakang layar.';
    base.accounts = ['penyimpanan kode', 'server', 'domain'];
  } else {
    base.connectionMessage = 'Saya akan memakai hosting terkelola supaya kamu tidak perlu mengurus server.';
    base.accounts = ['penyimpanan kode', 'data aplikasi', 'hosting', 'domain'];
  }

  if (blocked) {
    const first = plan.blockedBy?.[0];
    if (first?.capability === 'composio') {
      base.action = {
        title: 'Hubungkan akunmu',
        message: 'Saya perlu izin aman untuk mengakses layanan yang akan dipakai. Kamu tidak perlu mengirim password atau API key di chat.',
        buttonLabel: 'Hubungkan akun',
      };
    } else if (first?.capability === 'vps-runner') {
      base.action = {
        title: 'Hubungkan servermu',
        message: 'Karena kamu memilih server sendiri, saya perlu koneksi ke server tersebut sebelum bisa melanjutkan.',
        buttonLabel: 'Hubungkan server',
      };
    }
  }

  return base;
}

function userCredentialCard({ provider, createAt, note, saveWith, saveDestination, continueWith, hosted = false } = {}) {
  const name = friendlyProvider(provider);
  if (hosted) {
    return {
      title: `Hubungkan ${name}`,
      message: `Izinkan SI-Coder mengakses ${name} melalui halaman koneksi aman. Jangan kirim password atau key di chat.`,
      primaryAction: { label: `Hubungkan ${name}`, url: createAt || null },
      after: 'Setelah tersambung, saya akan melanjutkan otomatis.',
      technicalDetailsOptional: true,
    };
  }
  return {
    title: `Berikan akses ke ${name}`,
    message: 'Buat akses dari halaman resmi, lalu simpan melalui SI-Coder. Nilainya tidak akan ditampilkan kembali.',
    primaryAction: { label: 'Buka halaman resmi', url: createAt || null },
    instructions: note || null,
    saveAction: saveWith || null,
    after: 'Setelah disimpan, SI-Coder akan mengecek akses lalu melanjutkan.',
    technical: { saveDestination: saveDestination || null, verify: continueWith || null },
    technicalDetailsOptional: true,
  };
}

function friendlyRecommendation({ next, why, prerequisites = [], action } = {}) {
  return {
    label: '[rekomendasi]',
    title: next || 'Langkah berikutnya',
    reason: why || 'Supaya web app siap dipakai dengan lebih lengkap.',
    beforeWeStart: prerequisites,
    offer: action || 'Kalau kamu mau, saya bisa lanjutkan langkah ini.',
  };
}

module.exports = { friendlyProvider, userPlanForDeploy, userCredentialCard, friendlyRecommendation };
