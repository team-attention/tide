// Line-level diff algorithm using LCS (Longest Common Subsequence).

/// A single diff operation.
#[derive(Debug, Clone)]
pub enum DiffOp {
    /// Line exists in both disk and buffer (unchanged).
    Equal(usize),      // buffer line index
    /// Line exists only in buffer (added).
    Insert(usize),     // buffer line index
    /// Line exists only on disk (deleted).
    Delete(usize),     // disk line index
}

/// Compute a line-level unified diff between disk content and buffer content.
/// Returns a list of DiffOps representing how to display the diff.
pub fn compute_diff(disk: &[String], buffer: &[String]) -> Vec<DiffOp> {
    let n = disk.len();
    let m = buffer.len();

    // Build LCS table
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            if disk[i - 1] == buffer[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    // Backtrack to produce diff ops
    let mut ops = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && disk[i - 1] == buffer[j - 1] {
            ops.push(DiffOp::Equal(j - 1));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            ops.push(DiffOp::Insert(j - 1));
            j -= 1;
        } else {
            ops.push(DiffOp::Delete(i - 1));
            i -= 1;
        }
    }

    ops.reverse();
    ops
}
