const BASE = 'https://raw.githubusercontent.com/taigrr/spank/master/audio';

export interface AudioFile {
  name: string;
  download_url: string;
  category: string;
}

function make(category: string, names: string[]): AudioFile[] {
  return names.map(name => ({
    name,
    download_url: `${BASE}/${category}/${name}`,
    category,
  }));
}

function seq(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i).padStart(2, '0') + '.mp3');
}

export const AUDIO_FILES: AudioFile[] = [
  ...make('halo', seq(9)),
  ...make('lizard', ['00.mp3']),
  ...make('pain', [
    '00_Ow.mp3',
    '01_Ouch.mp3',
    '02_Owwie.mp3',
    '03_Hey_that_hurts.mp3',
    '04_Ow_stop_it.mp3',
    '05_What_was_that_for.mp3',
    '06_Ow_ow_ow.mp3',
    '07_Hey.mp3',
    '08_Yowch.mp3',
    '09_That_stings.mp3',
  ]),
  ...make('sexy', seq(60)),
];
