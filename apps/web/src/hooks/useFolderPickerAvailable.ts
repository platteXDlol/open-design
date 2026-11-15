import { useEffect, useState } from 'react';
import { fetchFolderPickerAvailable } from '../providers/registry';
import { isOpenDesignHostAvailable } from '@open-design/host';

/**
 * True when a "pick folder" button can actually open a dialog: the desktop host
 * has its own picker, otherwise the daemon must report one. `false` while the
 * daemon answer is pending, so headless installs never flash the button.
 */
export function useFolderPickerAvailable(): boolean {
  const [available, setAvailable] = useState(() => isOpenDesignHostAvailable());
  useEffect(() => {
    if (isOpenDesignHostAvailable()) return;
    let alive = true;
    void fetchFolderPickerAvailable().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
