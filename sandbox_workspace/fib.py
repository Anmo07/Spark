def fibonacci_sequence(n: int) -> int:
    if n < 0:
        raise ValueError('Input must be a non-negative integer')
    elif n == 0:
        return 0
    elif n == 1:
        return 1
    else:
        return fibonacci_sequence(n-1) + fibonacci_sequence(n-2)