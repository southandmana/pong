class SoundGenerator {
  private audioContext: AudioContext;
  private isEnabled: boolean = true;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  private resumeAudioContext = async () => {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  };

  private createBeep = (frequency: number, duration: number, volume: number = 0.1, waveType: OscillatorType = 'square') => {
    if (!this.isEnabled) return;

    this.resumeAudioContext();

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = waveType;

    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration - 0.01);
    gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  };

  paddleHit = () => {
    this.createBeep(220, 0.1, 0.15, 'square');
  };

  wallBounce = () => {
    this.createBeep(150, 0.08, 0.12, 'sawtooth');
  };

  score = () => {
    // Triple beep for scoring
    this.createBeep(330, 0.2, 0.2, 'triangle');
    setTimeout(() => this.createBeep(440, 0.2, 0.2, 'triangle'), 100);
    setTimeout(() => this.createBeep(550, 0.3, 0.2, 'triangle'), 200);
  };

  gameStart = () => {
    // Ascending beep sequence
    this.createBeep(200, 0.15, 0.15, 'square');
    setTimeout(() => this.createBeep(300, 0.15, 0.15, 'square'), 100);
    setTimeout(() => this.createBeep(400, 0.2, 0.15, 'square'), 200);
  };

  gamePause = () => {
    // Descending beep
    this.createBeep(400, 0.15, 0.15, 'square');
    setTimeout(() => this.createBeep(200, 0.2, 0.15, 'square'), 100);
  };

  gameReset = () => {
    // Quick blip
    this.createBeep(300, 0.1, 0.1, 'sine');
  };

  gameOver = () => {
    // Dramatic descending death sound
    this.createBeep(400, 0.3, 0.2, 'sawtooth');
    setTimeout(() => this.createBeep(300, 0.3, 0.2, 'sawtooth'), 200);
    setTimeout(() => this.createBeep(200, 0.5, 0.2, 'sawtooth'), 400);
    setTimeout(() => this.createBeep(100, 0.8, 0.15, 'sawtooth'), 700);
  };

  emptyGun = () => {
    // Empty gun click sound - short, dry click
    this.createBeep(150, 0.05, 0.08, 'square');
  };

  itemCollected = () => {
    // Pleasant pickup sound - ascending chime
    this.createBeep(440, 0.1, 0.12, 'sine');
    setTimeout(() => this.createBeep(550, 0.1, 0.12, 'sine'), 50);
    setTimeout(() => this.createBeep(660, 0.15, 0.12, 'sine'), 100);
  };

  bulletFired = () => {
    // Satisfying bullet firing sound - short sharp blast
    this.createBeep(800, 0.08, 0.15, 'square');
    setTimeout(() => this.createBeep(600, 0.05, 0.1, 'square'), 30);
  };

  bulletImpact = () => {
    // Bullet hitting paddle - punchy thud
    this.createBeep(200, 0.12, 0.18, 'sawtooth');
    setTimeout(() => this.createBeep(150, 0.08, 0.12, 'sawtooth'), 50);
  };

  paddleDamaged = () => {
    // Paddle taking damage - cracking sound
    this.createBeep(300, 0.15, 0.16, 'triangle');
    setTimeout(() => this.createBeep(250, 0.1, 0.12, 'triangle'), 80);
    setTimeout(() => this.createBeep(180, 0.12, 0.1, 'triangle'), 160);
  };

  healthLoss = () => {
    // Health lost - warning alarm
    this.createBeep(500, 0.2, 0.2, 'triangle');
    setTimeout(() => this.createBeep(350, 0.2, 0.15, 'triangle'), 150);
  };

  itemSpawned = () => {
    // Subtle item spawn notification - soft chime
    this.createBeep(660, 0.08, 0.08, 'sine');
    setTimeout(() => this.createBeep(880, 0.06, 0.06, 'sine'), 40);
  };

  menuClick = () => {
    // Menu button click - sharp click
    this.createBeep(800, 0.05, 0.1, 'square');
  };

  menuHover = () => {
    // Menu button hover - subtle beep
    this.createBeep(600, 0.03, 0.06, 'sine');
  };

  walkStep = () => {
    // Walking step sound - soft thump
    this.createBeep(120, 0.08, 0.08, 'triangle');
    setTimeout(() => this.createBeep(100, 0.06, 0.06, 'triangle'), 20);
  };

  runStep = () => {
    // Running step sound - faster, slightly higher pitched version of walk
    this.createBeep(140, 0.06, 0.09, 'triangle');
    setTimeout(() => this.createBeep(115, 0.04, 0.07, 'triangle'), 15);
  };

  toggleSound = () => {
    this.isEnabled = !this.isEnabled;
    return this.isEnabled;
  };

  getSoundStatus = () => this.isEnabled;
}

export default SoundGenerator;