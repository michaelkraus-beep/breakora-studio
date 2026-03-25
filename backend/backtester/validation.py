from dataclasses import dataclass
from datetime import datetime

@dataclass
class ValidationConfig:
    total_start: str   # ISO date
    total_end: str     # ISO date
    is_ratio: float    # In-sample ratio (e.g., 0.7 = 70% IS, 30% OOS)
    walk_forward_windows: int  # Number of rolling windows (0 = simple IS/OOS split)

def split_is_oos(total_start_ms: int, total_end_ms: int, is_ratio: float) -> tuple[tuple[int,int], tuple[int,int]]:
    """Returns ((is_start, is_end), (oos_start, oos_end)) in milliseconds."""
    duration = total_end_ms - total_start_ms
    is_duration = int(duration * is_ratio)
    
    is_start = total_start_ms
    is_end = total_start_ms + is_duration
    
    oos_start = is_end
    oos_end = total_end_ms
    
    return ((is_start, is_end), (oos_start, oos_end))

def generate_walk_forward_windows(total_start_ms: int, total_end_ms: int, n_windows: int, is_ratio: float) -> list[dict]:
    """Returns list of {"is_start", "is_end", "oos_start", "oos_end"} windows."""
    if n_windows <= 0:
        # Fallback to single split
        is_bounds, oos_bounds = split_is_oos(total_start_ms, total_end_ms, is_ratio)
        return [{"is_start": is_bounds[0], "is_end": is_bounds[1], "oos_start": oos_bounds[0], "oos_end": oos_bounds[1]}]
        
    total_duration = total_end_ms - total_start_ms
    
    # In walk forward, the total duration is split such that we have overlapping IS sets and advancing OOS sets.
    # We will slide the window n_windows times.
    # Let window_size = total_duration / (n_windows + is_ratio)
    # the first IS duration is window_size * is_ratio.
    # Wait, simpler:
    # Just fix the IS duration and OOS duration for each slice
    # Slide amount = (total_duration - initial_is_duration) / n_windows
    
    # Let's say we want initial IS to be is_ratio of total if n_windows=1
    # For multiple windows, the OOS segment is total * (1-is_ratio) divided by n_windows
    total_oos_duration = int(total_duration * (1.0 - is_ratio))
    oos_step = total_oos_duration // n_windows
    
    windows = []
    current_start = total_start_ms
    # IS duration remains fixed size across all windows?
    is_size = int(total_duration * is_ratio)
    
    for i in range(n_windows):
        is_start = current_start + (i * oos_step)
        is_end = is_start + is_size
        
        oos_start = is_end
        oos_end = oos_start + oos_step
        
        # Adjust last window OOS_end to avoid rounding gaps
        if i == n_windows - 1:
            oos_end = total_end_ms
            
        windows.append({
            "is_start": is_start,
            "is_end": is_end,
            "oos_start": oos_start,
            "oos_end": oos_end
        })
        
    return windows
